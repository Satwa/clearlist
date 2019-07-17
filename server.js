require('dotenv').config()

const express       = require('express')
const app           = express()
const bodyParser 	= require('body-parser')
const session 		= require('cookie-session')
const ejs           = require('ejs')
const urlExists 	= require('url-exists')
const requestify    = require('requestify')
const passport 		= require('passport')
const Sequelize     = require('sequelize')
const TwitterStrategy = require('passport-twitter').Strategy
const sequelize 	= new Sequelize(process.env.DATABASE_URL, { logging: false })
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
	schedule: Sequelize.STRING, // Timezone
	hour_preference: {
		type: Sequelize.INTEGER,
		defaultValue: 8
	},
	days_preference: {
		type: Sequelize.STRING,
		defaultValue: "0123456" // 0=> Sunday
	}
})

const Link = sequelize.define("links", {
	link: Sequelize.STRING,
	title: Sequelize.STRING,
	state: {
		type: Sequelize.INTEGER, 
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
					// Under this should probably be disabled if we want in-app customization
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

			done(null, {
				provider: "twitter",
				id: profile.id,
				displayName: profile.username,
				schedule: schedule,
				hour_preference: user ? user.hour_preference : "0123456",
				days_preference: user ? user.days_preference : 8,
				pocket_linked: user ? !!user.pocket_token : false
			})
		})
	  }
))


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
				schedule: user.schedule,
				hour_preference: user.hour_preference,
				days_preference: user.days_preference,
				pocket_linked: !!user.pocket_token
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
app.get("/login/callback", passport.authenticate('twitter', { successRedirect: '/account', failureRedirect: '/' }))

app.get("/login/pocket", (req, res) => {
	requestify.request("https://getpocket.com/v3/oauth/request", {
		method: "POST",
		dataType: "json",
		body: {
			consumer_key: process.env.POCKET_CONSUMER_KEY,
			redirect_uri: process.env.CALLBACK_URL + "login/pocket/callback"
		}
	}).then((response) => {
		let data = response.getBody()

		res.redirect(`https://getpocket.com/auth/authorize?request_token=${data.code}&redirect_uri=${process.env.CALLBACK_URL}login/pocket/callback?code=${data.code}`)
	}).catch((err) => {
		console.log(err)
		res.redirect('/account?toast=warning&message=Error-occurred-while-linking-your-Pocket-account,-please-try-again')
	})

})

app.get("/login/pocket/callback", (req, res) => {
	requestify.request("https://getpocket.com/v3/oauth/authorize", {
		method: "POST",
		dataType: "json",
		body: {
			consumer_key: process.env.POCKET_CONSUMER_KEY,
			code: req.query.code
		}
	}).then((response) => {
		let data = response.getBody()

		User.findOne({ where: { twitter_id: req.user.id } })
			.then((user) => {
				if(!user){
					console.log("No user")
					res.redirect("/")
					return
				}

				if(data.access_token){
					// Fetch from Pocket initially
					requestify.request("https://getpocket.com/v3/get", {
						method: "POST",
						dataType: "json",
						body: {
							access_token: data.access_token,
							consumer_key: process.env.POCKET_CONSUMER_KEY
						}
					}).then((res) => {
						let data = res.getBody()
						for (let item of Object.values(data.list)) {
							Link.findOne({ where: { user_id: user.twitter_id, link: item.resolved_url } })
								.then((link) => {
									if (!link) {
										Link.build({ link: item.resolved_url, user_id: user.twitter_id, title: item.resolved_title }).save()
											.then((data) => {
												console.log("[DEBUG] - Adding link for " + user.screen_name)
											})
									} else {
										console.log("[DEBUG] - Link existing for " + user.screen_name)
									}
								})
						}
					}).catch((err) => console.log(err))


					// Save token & redirect
					user.update({
						pocket_token: data.access_token
					})
					res.redirect("/account?toast=info&message=Successfully-linked-your-Pocket-account,-currently-syncing-your-list")
				} else {
					res.redirect("/account?toast=warning&message=Error-occurred-while-linking-your-Pocket-account,-please-try-again")
				}
			})
	})
})


app.get("/account", (req, res) => {
	if(!req.isAuthenticated()){
	    res.redirect("/")
	    return
	}

	Link.findAll({ where: {user_id: req.user.id}, order: [['state', 'ASC']] })
		.then((links) => {
			res.render("account", { links: links, preferences: { days: req.user.days_preference, hour: req.user.hour_preference } })
		})
})
app.post("/account/update", (req, res) => {
	if(!req.isAuthenticated() || !req.body.timezone_offset){
	    res.redirect("/")
	    return
	}

	let days = ""
	for(let i = 0; i < 7; i++){
		if(req.body[i.toString()]){
			days += i
		}
	}

	User.findOne({where: { twitter_id: req.user.id }})
		.then((user) => {
			if(!user){
				console.log("NO USER")
				return
			}
			user.update({
				schedule: req.body.timezone_offset,
				days_preference: days,
				hour_preference: req.body.hour_preference
			})
		})

	res.redirect("/account?toast=info&message=Preferences-successfully-updated!")
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

// DOING:
	// - Design account page
	// - Design landing Page

// TODO:
	// - Subscription (Stripe)
		// - Choose days
		// - Send this next
		// - Resend mail for later

// IDEAS FOR LATER:
	// - Telegram bot?
	// - Twitter bot?
	// - Watchlist (on weekend)
	// //- Notion-Medium

// nodemon server.js && maildev [ http://localhost:3000/account | http://localhost:1080/ ]

app.listen(process.env.PORT, () => {
  console.log('Server up and running on port ' + process.env.PORT)
}) 