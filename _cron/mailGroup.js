require('dotenv').config()
const Sequelize     = require('sequelize')
const sequelize = new Sequelize(process.env.DATABASE_URL, { logging: false })
const nodemailer 	= require('nodemailer')
const extractor 	= require('unfluff')
const requestify 	= require('requestify')
const ejs  		  	= require('ejs')
const read 			= require('node-readability')
const SummaryTool 	= require('node-summary')

sequelize
 	.authenticate()
	    .then(() => console.log("Successfully logged into storage") )
	    .catch((err) => console.error("Error logging into storage, error: " + err) )

var transporter
if(process.env.STATUS){ // only defined on dev env.
	transporter = nodemailer.createTransport({ // Configured for Maildev
		port: 1025,
		ignoreTLS: true
	})
}else{
	transporter = nodemailer.createTransport({
		host: process.env.MAIL_HOST,
		port: process.env.MAIL_PORT,
		secure: (process.env.MAIL_SECURE === 'false') ? false : true, // true for 465, false for other ports
		auth: {
			user: process.env.MAIL_USER,
			pass: process.env.MAIL_PASS
		}
	})
}


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
		defaultValue: 0 //0: to send | 1: sent
	},
	prioritize: {
		type: Sequelize.INTEGER,
		defaultValue: 0 // don't prioritze
	}
})

Link.belongsTo(User, {foreignKey: 'user_id'}) // Link is related a user
User.hasMany(Link, {foreignKey: 'user_id'}) // User has many links

User.sync()
Link.sync()

User.findAll({where: {
		schedule: {
			[Sequelize.Op.ne]: null // NOT NULL
		},
		// stripe_subscription_id: {
		// 	[Sequelize.Op.ne]: null // AND SUBSCRIBED
		// }
	}
}).then((users) => {
	users.forEach((user) => {
		let d = new Date()
		d.setHours(d.getUTCHours() + parseInt(user.schedule.split(":")[0]))

		if(true){ //d.getHours() == user.hour_preference
			if (user.stripe_subscription_id != null && !user.days_preference.includes(d.getDay().toString())){ // If premium and day is busy (= not activated)
				console.log(user.screen_name + " is a Premium user and won't receive a mail")
				return
			}
			console.log("Time to send mail for: " + user.screen_name)

			Link.findOne({
				where: {
					state: 0,
					user_id: user.twitter_id
				},
				order: [['prioritize', 'DESC'], sequelize.random()]
			}).then((link) => {
				if(!link){
					console.log("User has no more links waiting")
					return
				}
				read(link.link, (err, article, meta) => {
					if(err){
						console.log("Error fetching article.")
						console.warn(err)
						return
					}

					SummaryTool.summarize(article.title, article.content, function (err, summary) {
						let sum = ""
						if(!err){
							sum = summary

							ejs.renderFile("./_cron/template.ejs", {
								title: article.title,
								content: article.content,
								link: link.link,
								summary: sum
							}, {/* wut */ }, (err, str) => {
								if (err) {
									// TODO: Pick another one
									console.log("Error rendering template.")
									console.warn(err)

									sendMail(process.env.WARNING_EMAIL_NOTIFICATION, `[CL] Error rendering template for ${user.screen_name}`, "", `Error rending link ${article.title} with link ${link.link} at` + Date())
								} else {
									sendMail(user.email, "Reading Time - " + article.title, str, "Hey " + user.screen_name + ", here's a cool thing to read today! \n" + article.content)

									link.update({
										state: 1
									})
								}

								article.close()
							})
						}else{ 
							console.warn("Something went wrong when summarizing!")
						}

					})
				})

			}).catch((err) => console.warn(err))
		}
	})
}).catch((err) => console.warn(err))

let sendMail = (email, subject, html, text) => {
	let mailOptions = {
		from: "ClearList <read@clearlist.app>",
		to: email,
		subject: subject,
		html: html,
		text: text
	}

	transporter.sendMail(mailOptions, (err, info) => {
		if(err){
			console.warn("Error sending mail: " + err)
		}
		console.log("Mail sent.")
	})
} // text comes from html