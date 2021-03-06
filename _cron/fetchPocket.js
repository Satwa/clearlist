require('dotenv').config()
const Sequelize = require('sequelize')
const sequelize = new Sequelize(process.env.DATABASE_URL, { logging: false })
const requestify = require('requestify')

sequelize
    .authenticate()
    .then(() => console.log("Successfully logged into storage"))
    .catch((err) => console.error("Error logging into storage, error: " + err))

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

User.findAll({
    where: {
        schedule: {
            [Sequelize.Op.ne]: null
        },
        stripe_subscription_id: {
            [Sequelize.Op.ne]: null // AND SUBSCRIBED
        }
    }
}).then((users) => {
    users.forEach((user) => {
        if(!user.pocket_token){
            console.log("user has no pocket token — cancelling")
            return
        }

        let hrOffset = new Date()
        hrOffset.setHours(hrOffset.getHours() - 1)

        requestify.request("https://getpocket.com/v3/get", {
            method: "POST",
            dataType: "json",
            body: {
                access_token: user.pocket_token,
                consumer_key: process.env.POCKET_CONSUMER_KEY,
                since: Math.round(new Date(hrOffset).getTime() / 1000)
            }
        }).then((res) => {
            let data = res.getBody()
            for(let item of Object.values(data.list)){
                Link.findOne({ where: { user_id: user.twitter_id, link: item.resolved_url } })
                    .then((link) => {
                        if(!link){
                            Link.build({ link: item.resolved_url, user_id: user.twitter_id, title: item.resolved_title }).save()
                                .then((data) => {
                                    console.log("[DEBUG] - Adding link for " + user.screen_name)
                                })
                        }else{
                            console.log("[DEBUG] - Link existing for " + user.screen_name)
                        }
                    })
            }
        })
        .catch((err) => console.log(err))
    })
})