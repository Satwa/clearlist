require('dotenv').config()
const Sequelize     = require('sequelize')
const sequelize     = new Sequelize(process.env.DATABASE_URL, { logging: false })
const nodemailer 	= require('nodemailer')
const urlExists 	= require('url-exists')
const Imap          = require('imap')
const simpleParser  = require('mailparser').simpleParser
const { JSDOM }      = require("jsdom")

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

let imap = new Imap({
    user: process.env.BOT_EMAIL,
    password: process.env.BOT_PASS,
    host: process.env.BOT_HOST,
    port: process.env.BOT_PORT,
    tls: (process.env.BOT_SECURE === 'false') ? false : true,
    tlsOptions: { rejectUnauthorized: false }
})

function openInbox(cb) {
    imap.openBox('INBOX', false, cb)
}

imap.once('ready', function () {
    openInbox(function (err, box) {
        if (err) throw err;
        imap.search(['UNSEEN'], function (err, results) {
            if (err) throw err;
            let f
            try{
                f = imap.fetch(results, { bodies: "", markSeen: true, struct: true })
            }catch(err){
                console.log("BOT: no new email")
                imap.end()
                return
            }
            f.on('message', function (msg, seqno) {
                let buffer = ''
                msg.on('body', function (stream, info) {
                    stream.on('data', function (chunk) {
                        buffer += chunk.toString('utf8')
                    })
                    stream.once('end', function () {
                        simpleParser(buffer, {}, (err, parsed) => {
                            if(err){
                                console.warn("BOT: Error handling mail response", err)
                                return
                            }

                            try{
                                let dom = new JSDOM(parsed.html)
                                let allLinks = dom.window.document.querySelectorAll("a")
                              
                                handleMailAction(parsed.headers.get("from").value[0].address, parsed.text.replace(/ *\<[^)]*\> */g, ""), allLinks[allLinks.length - 4].getAttribute("href"))
                            }catch(err){
                                handleMailAction(parsed.headers.get("from").value[0].address, parsed.text.replace(/ *\<[^)]*\> */g, ""))
                            }
                        })
                    })
                })
            })
            f.once('error', function (err) {
                console.warn('BOT: Fetch error. ' + err)
            })
            f.once('end', function () {
                console.log('Done fetching all messages!')
                imap.end()
            })
        })
    })
})

imap.on('error', function (err) {
    console.warn(err)
})

imap.once('end', function () {
    console.log('BOT: Connection ended')
})

imap.connect()


let handleMailAction = (email, content, link = null /* Only when rescheduling */) => {
    User.findOne({
        where: {
            email: email
        }
    }).then((user) => {
        if(user){
            switch(content.trim().split(/\s/)[0]){
                case "todo":
                case "send":
                case "read":
                case "add":
                    console.log("BOT: New link to add")
                    saveLink(content.split(" ")[1], user.twitter_id)
                    break

                case "unseen":
                case "unsee":
                case "schedule":
                case "reschedule":
                case "resend":
                    console.log("BOT: Link to reschedule")
                    rescheduleLink(link, user.twitter_id)
                    // urlExists(content.trim().split(/\s+/)[1], function(err, exists) {
                    //     if(exists){
                    //         rescheduleLink(content.trim().split(/\s+/)[1], user.twitter_id)
                    //     }else{
                    //         rescheduleLink(link, user.twitter_id)
                    //     }
                    // })
                    break

                default:
                    console.warn("BOT: Error handling requested action")
                    sendMail(email, "Error understanding your action", "", `Hello ${user.screen_name}, \n\nWe've got an issue understanding your action. If you think this is wrong, please contact me at ${process.env.WARNING_EMAIL_NOTIFICATION}. \n\n Have a nice day!`)
            }

        }else{
            console.warn("BOT: Error email not registered")
            sendMail(email, "Error identifying who you are", "", `Hello friend, \n\nWe've got an issue finding who you are. If you think this is wrong, please contact me at ${process.env.WARNING_EMAIL_NOTIFICATION}. \n\n Have a nice day!`)
        }
    })
}

let saveLink = (link, uid) => {
    var url = link
    if (!link.includes("http")) {
        url = "http://" + link
    }

    urlExists(url, (err, exists) => {
        if (exists) {
            // Check for duplicates
            Link.findOne({ where: { user_id: uid, link: link, state: 0 } })
                .then((link) => {
                    if (!link) {
                        Link.build({ link: url, user_id: uid }).save()
                    }
                })
        }
    })
}

let rescheduleLink = (link, uid) => {
    Link.findOne({ where: { user_id: uid, link: link, state: { [Sequelize.Op.ne]: 0 } } })
        .then((link) => {
            if(link) {
                link.update({
                    state: 0
                })
            }
        })
}

let sendMail = (email, subject, html, text) => {
    let mailOptions = {
        from: "ClearList <read@clearlist.app>",
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