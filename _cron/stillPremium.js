require('dotenv').config()
const Sequelize = require('sequelize')
const sequelize = new Sequelize(process.env.DATABASE_URL, { logging: false })
const requestify = require('requestify')
const stripe = require("stripe")(process.env.STRIPE_KEY)

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

User.sync()

User.findAll({
    where: {
        stripe_subscription_id: {
            [Sequelize.Op.ne]: null 
        }
    }
}).then((users) => {
    users.forEach((user) => {
        stripe.subscriptions.retrieve(
            user.stripe_subscription_id,
            function (err, subscription) {
                err ? console.log(err) : null

                if(subscription.ended_at && Math.floor(Date.now()/3) > subscription.ended_at){
                    user.update({
                        stripe_subscription_id: null
                    })
                    console.log(user.screen_name + " has stopped his/her subscription")
                }
            }
        );
    })
})