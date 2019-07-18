require('dotenv').config()
const Sequelize     = require('sequelize')
const extract 		= require('meta-extractor')
const sequelize = new Sequelize(process.env.DATABASE_URL, { logging: false })

console.log("- Initializing fetchTitle cron task..")

sequelize
 	.authenticate()
	    .then(() => console.log("Successfully logged into storage") )
	    .catch((err) => console.error("Error logging into storage, error: " + err) )

const Link = sequelize.define("links", {
	link: Sequelize.STRING,
	title: Sequelize.STRING,
	state: {
		type: Sequelize.INTEGER, 
		defaultValue: 0 //0: to send / / 1: sent
	},
	prioritize: {
		type: Sequelize.INTEGER,
		defaultValue: 0 // don't prioritze
	}
})
Link.sync()

Link.findAll({where: {title: null}})
	.then((link) => {
		link.forEach((elm) => {
			extract({ uri: elm.link })
			  .then(res => elm.update({title: res.title}))
			  .catch(err => console.error(err));
			console.log(elm.title)
		})
	})





console.log("- Done fetchTitle cron task..")