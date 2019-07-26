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

if ((new Date()).getDay() == 3) { // every Wednesday 
    User.findAll({
        where: {
            schedule: {
                [Sequelize.Op.ne]: null // NOT NULL // TODO: AND SUBSCRIBED
            }
        }
    }).then((users) => {
        users.forEach((user) => {
                Link.findOne({
                    where: {
                        state: 0,
                        user_id: user.twitter_id
                    }
                }).then((link) => { // User without links unread
                    if (!link) {
                        console.log("User has no more links waiting, sending him an alert email")
    
                        let content = `I send you this automated email just to remind you that you've subscribed to ClearList and have no more articles waiting!
                                        <br><br>
                                        If you've read everything, here are my warm congratulations for completing this goal, this means ClearList works as I expected it to be!
                                        <br>
                                        If you still have no article added to your list, this is dead-simple and you can do it now by going to your <a href="https://clearlist.app/account">account</a> and adding manually a link or by syncing your Pocket account.
                                        <br><br>
                                        It's true, this email is automated but I've written it first. That's why I'd love to hear more from you about what you like, you dislike and what could be improved. I'm opened for any message (related or not to ClearList). You can do it by answering to this email, your answer will arrive right in my personal inbox!`

                        ejs.renderFile("./_cron/user-template.ejs", {
                            screen_name: user.screen_name,
                            link: "https://clearlist.app",
                            content: content
                        }, {/* wut */ }, (err, str) => {
                            if (err) {
                                console.warn(err)
                            } else {
                                sendMail(user.email, "You're running out of articles!", str, "Hey " + user.screen_name + ", just a friendly reminder to tell you that you have no article to be sent! \n\n" + content)
                            }
                        })
                    }
    
                }).catch((err) => console.log(err))
        })
    }).catch((err) => console.log(err))
}else{
    console.log("not time to send empty alert")
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