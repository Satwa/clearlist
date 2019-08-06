require('dotenv').config()
const Sequelize = require('sequelize')
const sequelize = new Sequelize(process.env.DATABASE_URL, { logging: false })
const nodemailer = require('nodemailer')
const ejs = require('ejs')

sequelize
    .authenticate()
    .then(() => console.log("Successfully logged into storage"))
    .catch((err) => console.error("Error logging into storage, error: " + err))

var transporter
if (process.env.STATUS) { // only defined on dev env.
    transporter = nodemailer.createTransport({ // Configured for Maildev
        port: 1025,
        ignoreTLS: true
    })
} else {
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

Link.belongsTo(User, { foreignKey: 'user_id' }) // Link is related a user
User.hasMany(Link, { foreignKey: 'user_id' }) // User has many links

User.sync()
Link.sync()

if (true) { // every wednesday
    User.findAll({
        where: {
            stripe_subscription_id: null
        }
    }).then((users) => {
        users.forEach((user) => {
            console.log("User hasn't subscribed, sending him an alert email")

            let content = `ClearList has switched from a freemium model to a subscription model. Running this project costs me money that I don't have and I'm pretty sure that if you love it, you will subscribe for the price of a coffee every month!
                            <br><br>
                            Plus, you will start with a 15-day free trial and the subscription is cancellable at any time. To start activating it, it's dead-simple: you just have to go to your <a href="https://clearlist.app/account">account</a>, no credit card required.
                            <br><br>
                            <i>I hope this won't be a no-go for you and if you think this is unfair, hit the reply button and let's talk about how to make it better for you!</i>`

            ejs.renderFile("./_cron/user-template.ejs", {
                screen_name: user.screen_name,
                link: "https://clearlist.app",
                content: content
            }, {/* wut */ }, (err, str) => {
                if (err) {
                    console.warn(err)
                } else {
                    sendMail(user.email, "You need to activate your free trial.", str, "Hey " + user.screen_name + ", ClearList has switched from freemium to subscription model, let's talk! \n\n" + content)
                }
            })
        })
    }).catch((err) => console.log(err))
} else {
    console.log("not time to send subscription alert")
}


let sendMail = (email, subject, html, text) => {
    let mailOptions = {
        from: "Joshua from ClearList <me@joshuatabakhoff.com>",
        to: email,
        subject: subject,
        html: html,
        text: text
    }

    transporter.sendMail(mailOptions, (err, info) => {
        if (err) {
            console.warn("Error sending mail: " + err)
        }
        console.log("Mail sent.")
    })
}