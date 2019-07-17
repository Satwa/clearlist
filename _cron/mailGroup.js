require('dotenv').config()
const Sequelize     = require('sequelize')
const sequelize = new Sequelize(process.env.DATABASE_URL, { logging: false })
const nodemailer 	= require('nodemailer')
const extractor 	= require('unfluff')
const requestify 	= require('requestify')
const ejs  		  	= require('ejs')
const read 			= require('node-readability')

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
		secure: process.env.MAIL_SECURE, // true for 465, false for other ports
		auth: {
			user: process.env.MAIL_USER, // generated ethereal user
			pass: process.env.MAIL_PASS // generated ethereal password
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
	}
})

const Link = sequelize.define("links", {
	link: Sequelize.STRING,
	title: Sequelize.STRING,
	state: {
		type: Sequelize.INTEGER, 
		defaultValue: 0 //0: to send | 1: sent
	}
})

Link.belongsTo(User, {foreignKey: 'user_id'}) // Link is related a user
User.hasMany(Link, {foreignKey: 'user_id'}) // User has many links

User.sync()
Link.sync()

/*
TODO:
 - Mail title
 - Matomo analysis (is this mail being read and solving the problem?)
*/


User.findAll({where: {
		schedule: {
			[Sequelize.Op.ne]: null // NOT NULL // TODO: AND SUBSCRIBED
		}
	}
}).then((users) => {
	users.forEach((user) => {
		let d = new Date() // WIP: Is this GMT+0?
		d.setHours(d.getHours() + parseInt(user.schedule.split(":")[0]))

		if(d.getHours() == user.hour_preference && user.days_preference.includes(d.getDay().toString())){
			console.log("Time to send mail for: " + user.screen_name)

			Link.findOne({
				where: {
					state: 0,
					user_id: user.twitter_id
				},
				order: sequelize.random()
			}).then((link) => {
				if(!link){
					console.log("User has no more links waiting")
					return
				}
				read(link.link, (err, article, meta) => {
					ejs.renderFile("./_cron/template.ejs", {
						title: article.title,
						content: article.content,
						link: link.link,
					}, {/* wut */}, (err, str) => {
						if(err){
							console.warn(err)
						}else{
							sendMail(user.email, "ClearList - Reading Time", str, "Hey " + user.screen_name + ", here's a cool thing to read today! \n" + article.content) 
						}
						
						link.update({
							state: true
						})
						
						article.close()
					})
				})

			}).catch((err) => console.log(err))
		}
	})
}).catch((err) => console.log(err))

let sendMail = (email, subject, html, text) => {
	let mailOptions = {
		from: "ClearList <read@clearlist.com>",
		to: email,
		subject: subject,
		html: html,
		text: text
	}

	transporter.sendMail(mailOptions, (err, info) => {
		if(err){
			console.warn(err)
		}
	})
} // text comes from html