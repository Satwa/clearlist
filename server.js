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

const stripe 		= require("stripe")(process.env.STRIPE_KEY)
const CALLBACKURL   = process.env.CALLBACK_URL

// Scheduler
schedule.scheduleJob("0 1 * * *", () => {
	require("./_cron/stillPremium") // check subscriptions every day
})

schedule.scheduleJob("10 9 * * 3", () => {
	require("./_cron/emptyListAlert") // send mail to users with empty list on wednesday
	require("./_cron/emptyTimezoneAlert") // send mail to users with no timezone on wednesday
	require("./_cron/premiumRequiredAlert") // send mail to users with no subscription on wednesday
})

schedule.scheduleJob("01 * * * *", () => {
	require("./_cron/fetchPocket") // fetch from Pocket every hour

	require("./_cron/mailGroup") // mail group every hour
})
schedule.scheduleJob("*/2 * * * *", () => {
	require("./_cron/fetchTitle") // every 5 minutes
})

app.set('view engine', "ejs")
app.use(express.static('public'))

app.use("/api/stripe/webhook", bodyParser.raw({ type: 'application/json' }))
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
	},
	stripe_customer_id: Sequelize.STRING,
	stripe_subscription_id: Sequelize.STRING
})

const Link = sequelize.define("links", {
	link: Sequelize.STRING,
	title: Sequelize.STRING,
	state: {
		type: Sequelize.INTEGER, 
		defaultValue: 0 //0: to send || 1: sent
	},
	prioritize: {
		type: Sequelize.INTEGER,
		defaultValue: 0 // don't prioritze
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
				pocket_linked: user ? !!user.pocket_token : false,
				isPremium: user ? (user.stripe_subscription_id != null) : false
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
				pocket_linked: !!user.pocket_token,
				isPremium: (user.stripe_subscription_id != null)
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
app.get("/login/callback", passport.authenticate('twitter', { failureRedirect: '/' }), (req, res) => {
	// Handle login subscription part
	if(req.user.isPremium){
		res.redirect("/account")
	}else{
		User.findOne({ where: { twitter_id: req.user.id } })
			.then((user) => {
				// User is not premium, either first login or wasn't at previous login
				stripe.customers.list({ limit: 100 }, (err, data) => { // TODO: Handle > 100 customers
					let customers = data.data
					let userCustomer = customers.filter((e) => e.email == user.email)[0]

					if(userCustomer && !userCustomer.subscriptions.data){ // Previous customer found but has no subscription
						console.log("SUB: Customer found without subscription")
						stripe.subscriptions.create({
							customer: userCustomer.id,
							items: [{ plan: process.env.STRIPE_PLAN_ID }],
							trial_period_days: 15
						}, (err, subscription) => {
							user.update({
								stripe_customer_id: userCustomer.id,
								stripe_subscription_id: subscription.id
							})
						})
					}else if(userCustomer && userCustomer.subscriptions.data.length > 0){ // Previous customer found with subscription
						console.log("SUB: Customer found with subscription")
						// Update subscription & link to database
						stripe.subscriptions.update(userCustomer.subscriptions.data[0].id, {
							cancel_at_period_end: false,
							items: [{
								id: userCustomer.subscriptions.data[0].items.data[0].id,
								plan: process.env.STRIPE_PLAN_ID,
							}]
						})

						user.update({
							stripe_customer_id: userCustomer.id,
							stripe_subscription_id: userCustomer.subscriptions.data[0].id
						})
					}else{ // No customer
						console.log("SUB: No customer found, creating one w/ subscription")
						// Create customer + subscription & link to database
						stripe.customers.create({
							email: user.email
						}, (err, customer) => {
							stripe.subscriptions.create({
								customer: customer.id,
								items: [{ plan: process.env.STRIPE_PLAN_ID }],
								trial_period_days: 15
							}, (err, subscription) => {
								if(!err){
									user.update({
										stripe_customer_id: customer.id,
										stripe_subscription_id: subscription.id
									})
								}
							})
						})
					}
				})
				res.redirect("/account")
			})
	}
})

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
					}).then((response) => {
						let data = response.getBody()
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

							if(item.resolved_url == data.list[Object.keys(data.list)[Object.keys(data.list).length - 1]].resolved_url){ // if last item -> redirect
								res.redirect("/account?toast=info&message=Successfully-linked-your-Pocket-account,-currently-syncing-your-list")
							}
						}
					}).catch((err) => console.log(err))


					// Save token
					user.update({
						pocket_token: data.access_token
					})
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

app.get('/account/dump', (req, res) => {
	if (!req.isAuthenticated()) {
		res.redirect("/")
		return
	}
	User.findOne({
		attributes: ["screen_name", "email", "schedule", "hour_preference", "days_preference", "createdAt", "updatedAt"],
		where: {
			twitter_id: req.user.id
		}
	}).then((user) => {
		if(!user){
			res.sendStatus(404)
			return
		}
		Link.findAll({
			attributes: ["link", "title", "state", "prioritize", "createdAt", "updatedAt"],
			where: {
				user_id: req.user.id
			}
		}).then((links) => {
			res.json({user: user, links: links})
		})
	})
})

app.get("/account/cancel", (req, res) => {
	if (!req.isAuthenticated()) {
		res.redirect("/")
		return
	}
	User.findOne({ where: { twitter_id: req.user.id, stripe_subscription_id: { [Sequelize.Op.ne]: null } } })
		.then((user) => {
			if (!user) {
				res.redirect("/")
				return
			}

			stripe.subscriptions.update(user.stripe_subscription_id, { cancel_at_period_end: true })
			res.redirect('/account?toast=info&message=Your-subscription-will-be-cancelled-at-the-end-of-the-period-and-won\'t-be-renewed.')
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
			let updates = {
				schedule: req.body.timezone_offset,
				hour_preference: req.body.hour_preference
			}
			
			if(user.stripe_subscription_id != null){
				// isPremium
				updates["days_preference"] = days
			}
			user.update(updates)
		})

	res.redirect("/account?toast=info&message=Preferences-successfully-updated!")
})
app.get('/account/forcepocket', (req, res) => {
	if (!req.isAuthenticated()) {
		res.redirect("/")
		return
	}
	User.findOne({ where: { twitter_id: req.user.id } })
		.then((user) => {
			if (!user) {
				res.redirect("/")
				return
			} 
			requestify.request("https://getpocket.com/v3/get", {
				method: "POST",
				dataType: "json",
				body: {
					access_token: user.pocket_token,
					consumer_key: process.env.POCKET_CONSUMER_KEY
				}
			}).then((response) => {
				let data = response.getBody()
				for (let item of Object.values(data.list)) {
					Link.findOne({ where: { user_id: user.twitter_id, link: item.resolved_url } })
						.then((link) => {
							if (!link) {
								Link.build({ link: item.resolved_url, user_id: user.twitter_id, title: item.resolved_title }).save()
									.then((data) => {
										console.log("[DEBUG] - Force importing link for " + user.screen_name)
									})
							}
						})
				}
				res.redirect('/account?toast=info&message=Links-were-successfully-imported-from-Pocket.')
			}).catch((err) => console.log(err))
		})
})


app.get('/', function(request, response) {
	if(request.isAuthenticated()){
	    response.redirect("/account")
	    return
	}
	response.render('home')
})

app.get("/legal", (req, res) => {
	res.render('legal-notices')
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

app.put("/api/link/:id", (req, res) => { // Update to unread
	if (req.isAuthenticated()) {
		console.log("Authentication OK.")
		User.findOne({ where: { twitter_id: req.user.id } })
			.then((user) => {
				if (user.stripe_subscription_id != null) {
					Link.findOne({ where: { user_id: req.user.id, id: req.params.id, state: { [Sequelize.Op.ne]: 0 } } })
						.then((link) => {
							if (!link) {
								res.send(JSON.stringify({ success: false, message: "Link cannot be updated" }))
							} else {
								link.update({
									state: 0
								})
								res.send(JSON.stringify({ success: true, message: 'OK' }))
							}
						})
				}else{
					res.send(JSON.stringify({ success: false, message: 'premium' }))
				}
			})
	} else {
		console.log("Anonymous :(")
		res.sendStatus(403)
	}
})

app.patch("/api/link/:id", (req, res) => {
	if(req.isAuthenticated()){
		console.log("Authentication OK.")

		User.findOne({ where: { twitter_id: req.user.id } })
			.then((user) => {
				if(user.stripe_subscription_id != null){
					Link.findOne({ where: { user_id: req.user.id, state: 0, prioritize: 1 } }) // Find a link user has prioritized and remove his priority
						.then((link) => {
							if (link && link.id != req.params.id) {
								link.update({
									prioritize: 0
								})
							}

							Link.findOne({ where: { user_id: req.user.id, id: req.params.id, state: 0 } }) // Update the link user wants to receive next
								.then((link) => {
									if (!link) {
										res.send(JSON.stringify({ success: false, message: "Link cannot be prioritized" }))
									} else {
										link.update({
											prioritize: 1
										})

										res.send(JSON.stringify({ success: true, message: 'OK' }))
									}
								})
						})
				}else{
					res.send(JSON.stringify({ success: false, message: 'premium' }))
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

app.delete('/api/account', (req, res) => {
	if(req.isAuthenticated()){
		Link.destroy({
			where: {
				user_id: req.user.id
			}
		}).then((f) => {
			User.findOne( { where: { twitter_id: req.user.id } })
				.then((user) => {
					stripe.subscriptions.update(user.stripe_subscription_id, { cancel_at_period_end: true })

					User.destroy({
						where: {
							twitter_id: req.user.id
						}
					}).then(() => {
						res.send(JSON.stringify({ success: true, message: "Account deleted", refresh: true }))
					})
				})
		})
	}else{
		res.sendStatus(403)
	}
})

app.get('/api/metrics', (req, res) => {
	if(req.isAuthenticated() && req.user.id == process.env.ADMIN_UID){ // avoid dos breach on database
		let final_users = {
			all: [],
			with_pocket: [],
			without_timezone: []
		}
		let final_links = {
			all: [],
			sent: []
		}
		User.findAll()
			.then((users) => {
				final_users.all = users
				for(let user of users){
					if(!!user.pocket_token){
						final_users.with_pocket.push(user)
					}
					if(user.schedule == null){
						final_users.without_timezone.push(user)
					}
				}
				Link.findAll()
					.then((links) => {
						final_links.all = links
						for(let link of links){
							if(link.state != 0){
								final_links.sent.push(link)
							}
						}

						res.send({
							users_global: final_users.all.length,
							users_with_pocket: final_users.with_pocket.length,
							users_without_timezone: final_users.without_timezone.length,
							links_global: final_links.all.length,
							links_sent: final_links.sent.length
						})
					})
			})
	}else{
		res.sendStatus(403)
	}
})

app.post('/api/stripe/webhook', (request, response) => {
	const sig = request.headers['stripe-signature'];

	let event;

	try {
		event = stripe.webhooks.constructEvent(request.body, sig, process.env.STRIPE_ENDPOINT_SECRET);
	} catch (err) {
		console.log(err)
		return response.status(400).send(`Webhook Error: ${err.message}`);
	}

	// Handle the checkout.session.completed event
	if (event.type === 'checkout.session.completed') {
		const session = event.data.object;
		
		User.findOne({ where: { twitter_id: session.client_reference_id } })
			.then((user) => {
				if(!user){
					console.log("ISSUE: Subscription to undefined user...")
					return
				}
				console.log(user.screen_name + " has completed subscription")
				user.update({
					stripe_customer_id: session.customer,
					stripe_subscription_id: session.subscription
				})
			})
	} // TODO: Handle new events

	// Return a response to acknowledge receipt of the event
	response.json({ received: true });
});

// nodemon server.js && maildev [ http://localhost:3000/account | http://localhost:1080/ ]
app.listen(process.env.PORT, () => {
  console.log('Server up and running on port ' + process.env.PORT)
}) 