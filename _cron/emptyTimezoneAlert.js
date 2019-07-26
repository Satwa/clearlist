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

if (true) { // every wednesday // (new Date()).getDay() == 3
    User.findAll({
        where: {
            schedule: null
        }
    }).then((users) => {
        users.forEach((user) => {
            console.log("User has no timezone, sending him an alert email")

            let content = `I send you this automated email just to tell you that you are registered on ClearList but your account isn't completely set up. Indeed, you haven't selected a timezone yet, which means you won't be able to receive any email from ClearList except this one.
                            <br><br>
                            It's dead-simple: you just have to go to your <a href="https://clearlist.app/account">account</a>, select your favorite hour and timezone and save your preferences. Then, you'll have to add articles' link either manually or by syncing your Pocket account.
                            <br><br>
                            This email is automated but I'd love if you take some time to answer to this email. Your answer will arrive right in my personal inbox! What do you like and dislike, what could be improved? I'm opened for any message (related or not to ClearList).`

            ejs.renderFile("./_cron/user-template.ejs", {
                screen_name: user.screen_name,
                link: "https://clearlist.app",
                content: content
            }, {/* wut */ }, (err, str) => {
                if (err) {
                    console.warn(err)
                } else {
                    sendMail(user.email, "Your account is not ready yet", str, "Hey " + user.screen_name + ", just a friendly reminder to tell you that you have no timezone selected yet! \n\n" + content)
                }
            })
        })
    }).catch((err) => console.log(err))
} else {
    console.log("not time to send timezone alert")
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