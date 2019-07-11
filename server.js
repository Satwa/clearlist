require('dotenv').config()

const express       = require('express')
const app           = express()
const bodyParser 	= require('body-parser')
const session 		= require('cookie-session')
const ejs           = require('ejs')
const urlExists 	= require('url-exists')

const Twit 			= require('twit')
const passport 		= require('passport')
const Sequelize     = require('sequelize')
const TwitterStrategy = require('passport-twitter').Strategy
const PocketStrategy  = require('passport-pocket')
const sequelize 	= new Sequelize('sqlite://data/storage.sqlite', { logging: false })
const schedule 		= require('node-schedule')

// const stripe 		= require("stripe")(process.env.STRIPE_KEY)
const CALLBACKURL   = process.env.CALLBACK_URL

// Scheduler
schedule.scheduleJob("01 * * * *", () => {
	require("./_cron/fetchPocket") // fetch from Pocket every hour

	require("./_cron/mailGroup") // mail group every hour
})
schedule.scheduleJob("*/2 * * * *", () => {
	require("./_cron/fetchTitle") // every 5 minutes
})

app.set('view engine', "ejs")
app.use(express.static('public'))

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))
app.use(session({
  name: 'session',
  keys: [process.env.SESSION_KEY],
  maxAge: 168 * 60 * 60 * 1000 // 168 hours (7 days)
}))
app.use(passport.initialize())
app.use(passport.session())

app.use((req, res, next) => {
	res.locals.user  = req.user
	res.locals.isLog = req.isAuthenticated()
	next()
})

sequelize
 	.authenticate()
	    .then(() => console.log("Successfully logged into storage") )
	    .catch((err) => console.error("Error logging into storage, error: " + err) )


const User = sequelize.define("users", {
	screen_name: Sequelize.STRING,
	pocket_token: Sequelize.STRING,
	email: Sequelize.STRING,
	twitter_id: {
		type: Sequelize.STRING,
		primaryKey: true
	},
	twitter_access: Sequelize.STRING,
	twitter_secret: Sequelize.STRING,
	schedule: Sequelize.STRING // Timezone
})

const Link = sequelize.define("links", {
	link: Sequelize.STRING,
	title: Sequelize.STRING,
	state: {
		type: Sequelize.BOOLEAN, 
		defaultValue: 0 //0: to send || 1: sent
	}
})

Link.belongsTo(User, {foreignKey: 'user_id'}) // Link is related a user
User.hasMany(Link, {foreignKey: 'user_id'}) // User has many links


User.sync() // {force: true} to reset data
Link.sync()



// Passport init
passport.use(new TwitterStrategy({
	    consumerKey: process.env.TWITTER_CONSUMER,
	    consumerSecret: process.env.TWITTER_CONSUMER_SECRET,
	    callbackURL: CALLBACKURL + "login/callback", 
	    includeEmail: true
	},
	function(token, tokenSecret, profile, done) { // Check user profile
    	let schedule = null
    	User.findOne({
    		where: {
        		twitter_id: profile.id
      		}
    	})
    	.then((user) => {
	     	if(user){ // User found, we update
		        console.log("User found")
		        schedule = user.schedule
		        user.update({
		        	twitter_access: token,
		        	twitter_secret: tokenSecret,
		        	screen_name: profile.displayName,
		            email: profile.emails[0].value
		        })
	      	}else{ // No user, we create one
		        console.log("No user") 
		        User.build({
		            name: profile.username,
		            screen_name: profile.displayName,
		            twitter_access: token,
		            twitter_secret: tokenSecret,
		            twitter_id: profile.id,
		            email: profile.emails[0].value
		        }).save()
	      	}
	    })
	    done(null, {
	    	provider: "twitter",
	    	id: profile.id,
	    	displayName: profile.username,
	    	schedule: schedule
	    })
	  }
))

passport.use(new PocketStrategy({
	 consumerKey    : process.env.POCKET_CONSUMER_KEY,
     callbackURL    : CALLBACKURL + "login/pocket/callback"
}, (username, token, done) => {
	done(null, token)
}))


passport.serializeUser(function(user, done) {
	done(null, user.id)
})

passport.deserializeUser(function(id, done) {
	User.findOne({
    	where: {
      		twitter_id: id
    	}
  	})
  	.then((user, err) => {
	    if(user){
	    	done(null, {
	      		provider: "twitter",
	    		id: user.twitter_id,
	        	displayName: user.screen_name,
	        	schedule: user.schedule
	      	})
	    }else{
	    	console.log("no user")
	    	done(err, null)
	    }
	})
})

/* ROUTES */

// Login-related
app.get("/logout", (req, res) => { req.logout(); res.redirect('/') })
app.get("/login", passport.authenticate('twitter'))
app.get("/login/pocket", passport.authorize('pocket', { failureRedirect: '/account' }))

app.get("/login/pocket/callback", 
	passport.authorize('pocket', { failureRedirect: '/account' }),
	(req, res) => {
		User.findOne({ where: { twitter_id: req.user.id } })
			.then((user) => {
				if(!user){
					console.log("NO USER")
					return
				}
				user.update({
					pocket_token: req.account
				})
			})

		res.redirect("/account")
	})

app.get("/login/callback", passport.authenticate('twitter', { successRedirect: '/account', failureRedirect: '/' }))

app.get("/account", (req, res) => {
	if(!req.isAuthenticated()){
	    res.redirect("/")
	    return
	}
	
	Link.findAll({where: {user_id: req.user.id}, order: [['state', 'ASC']] })
		.then((links) => {
			res.render("account", {links: links})
		})
})
app.post("/account/update", (req, res) => {
	if(!req.isAuthenticated() || !req.body.timezone_offset){
	    res.redirect("/")
	    return
	}

	let timezone_offset = req.body.timezone_offset

	User.findOne({where: { twitter_id: req.user.id }})
		.then((user) => {
			if(!user){
				console.log("NO USER")
				return
			}
			user.update({
				schedule: timezone_offset
			})
		})

	res.redirect("/account")
})

app.get('/', function(request, response) {
	if(request.isAuthenticated()){
	    response.redirect("/account")
	    return
	}
	response.render('home')
})

app.post("/api/link/add", (req, res) => {
	if(req.isAuthenticated()){
		let link = req.body.link
		if(!link.includes("http")){
			link = "http://" + link
		}
		let linkUrl = link
		urlExists(link, (err, exists) => {
			if(exists){
				// Check for duplicates
				Link.findOne({ where: { user_id: req.user.id, link: link, state: 0 } })
					.then((link) => {
						if(!link){
							Link.build({ link: linkUrl, user_id: req.user.id }).save()
								.then((data) => {
									res.send(JSON.stringify({success: true, linkId: data.dataValues.id}))
								})
						}else{
							res.send(JSON.stringify({success: false, linkId: null}))
						}
					})
			}else{
				res.send(JSON.stringify({success: false}))
			}
		})
	}else{
		console.log("Anonymous :(")
		res.sendStatus(403)
	}
})

app.delete("/api/link/:id", (req, res) => {
	if(req.isAuthenticated()){
		console.log("Authentication OK.")

		Link.findOne({ where: { user_id: req.user.id, id: req.params.id, state: 0 } })
			.then((link) => {
				if(!link){
					res.send(JSON.stringify({success: false, message: "Link cannot be deleted"}))
				}else{
					link.destroy()
					res.send(JSON.stringify({success: true, message: 'OK'}))
				}
			})

	}else{
		console.log("Anonymous :(")
		res.sendStatus(403)
	}
})


// TODO: ClearList for:
		// vvv https://getpocket.com/developer/docs/v3/retrieve vvv //
    // - UptimeRobot on server
    // - Telegram bot?
    // - Twitter bot?
    // - Subscription (Stripe)
 		// - Just in case of premium feature - no idea yet
    // [- Resend mail for later
    // [- Send this next
    // [- Choose days and hour preferred for mail
    // [- Edit profile (?)
    // - Watchlist (on weekend)
    // //- Notion-Medium

// nodemon server.js && maildev [ http://localhost:3000/account | http://localhost:1080/ ]

app.listen(process.env.PORT, () => {
  console.log('Server up and running on port ' + process.env.PORT)
}) 