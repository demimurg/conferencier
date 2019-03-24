const MongoClient = require('mongodb').MongoClient;

class MongoDB{
	constructor(url) {
		this.url = url
		this.name = 'bot-node'
		this.db = 'availible after init'
	}

	async init() {
		this.client = new MongoClient(this.url, { useNewUrlParser: true })

		try {
			await this.client.connect()
			this.db = this.client.db(this.name)
		} catch (err) {
			console.log(err)
		}
	}

	async close() {
		await this.client.close()
	}

	async addUser(_id, name) {
		const users = this.db.collection('users')

		const user_exist = await users.findOne({ _id })
		if ( !user_exist ) {
			let updated = new Date()
			await users.insertOne({_id, name, updated})
		}   
	}

	async userData(id, params={}) {
		const users = this.db.collection('users')

		if (Object.keys(params).length) {
			if (params.location) {
				params.location = {
					type: 'Point',
					coordinates: [
						params.location.longitude,
						params.location.latitude
					]
				}

				params.updated = new Date()
			}

			await users.updateOne({ _id: id }, { $set: params })
		}

		const doc = await users.findOne(
			{ _id: id }, 
			{ projection: { _id: 0, status: 1, location: 1 } }
		)
		return doc
	}


	async getMovieData(input) {
		const movies = this.db.collection('movies')
		let movie_schema

		if (typeof(input) === 'number') {
			movie_schema = await movies.findOne({ _id: input })
		} else {
			input = '"' + input.split(' ').join('" "') + '"'
			movie_schema = await movies.findOne({ 
				$text: { $search: input } 
			})
		}

		return movie_schema
	}

	async moviesList() {
	 	const movies = this.db.collection('movies')

	 	const most_popular = await movies.find({})
	 		.sort({'showcounts': -1}).limit(12)
	 		.project({ name: 1, rating: 1 }).toArray()

	 	const high_ranking = await movies.find({})
	 		.sort({'rating.kp': -1}).limit(12)
	 		.project({ name: 1, rating: 1 }).toArray()

	 	return [most_popular, high_ranking]
	}

	async getCinemaData(input) {
	 	const cinemas = this.db.collection('cinemas')
	 	const time = (new Date).toTimeString().slice(0, 5)

	 	let schema
	 	if (typeof(input) === 'number') {
	 		schema = await cinemas.findOne({ _id: input })
	 	} else {
	 		input = '"' + input.split(' ').join('" "') + '"'
	 		schema = await cinemas.findOne({ 
				$text: { $search: input } 
			})
	 	}
	 	
	 	if (schema) {
	 		let movies = Object.keys(schema.schedule)
	 		movies.forEach((movie_name) => {
	 			let correct_name = movie_name.replace(/\[dot\]/g, '.')
	 			if (movie_name !== correct_name) {
	 				schema.schedule[correct_name] = schema.schedule[movie_name]
	 				delete schema.schedule[movie_name]
	 				movie_name = correct_name
	 			}

	 			schema.schedule[movie_name] = schema.schedule[movie_name]
	 				.filter((seance) => seance.time >= time || seance.time < '03:00')

	 			schema.schedule[movie_name].sort((a, b) => {
	 				if (a.time <= '03:00' && b.time > '03:00') return true
	 				else if (b.time <= '03:00' && a.time > '03:00') return false
	 				else if (a.time > b.time) return true
	 				else return false
	 			})
	 			if (schema.schedule[movie_name].length === 0) delete schema.schedule[movie_name]
	 		})
	 	}

	 	return schema
	}

	async getSchedule(id, name) {
		let { location: { coordinates: user_coord } } = await this.userData(id)
		const cinemas = this.db.collection('cinemas')

		name = name.replace(/\./g, '[dot]')
		const time = (new Date).toTimeString().slice(0, 5)

		const matched_cinemas = await cinemas.aggregate([
			{
				$geoNear: {
				  	near: { type: "Point", coordinates: user_coord },
				  	spherical: true,
				  	limit: 5,
 					maxDistance: 25000,
				  	query: { 
						$or: [
							{ [`schedule.${name}.time`]: { $gte: time } }, 
							{ [`schedule.${name}.time`]: { $lte: '03:00' } }
						]
				  	},
				  	distanceField: 'distance'
				}

			},
			{
				$addFields: {
					schedule: `$schedule.${name}`
				}
			},
			{
				$project: {
					name: 1,
					distance: 1,
					schedule: {
						$filter: {
							input: '$schedule',
							as: 'seance',
							cond: { 
								$or: [
									{ $gte: [ '$$seance.time', time ] },
									{ $lte: [ '$$seance.time', '03:00' ] }
								]	
							}
						}
					}
				}
			}
		]).toArray()

		return matched_cinemas
	}

	async cinemasNearby(id) {
		let { location: user_loc } = await this.userData(id)
		const cinemas = this.db.collection('cinemas')

		const nearest = cinemas.aggregate([
			{
				$geoNear: {
				  	near: user_loc,
				  	spherical: true,
				  	limit: 6,
 					maxDistance: 25000,
				  	distanceField: 'distance'
				}

			},
			{
				$project: {
					name: 1,
					metros: 1,
					distance: 1
				}
			}
		]).toArray()

		return nearest
	}

}


module.exports = MongoDB