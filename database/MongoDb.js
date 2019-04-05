const MongoClient = require('mongodb').MongoClient
const ObjectID = require('mongodb').ObjectID

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
		const location = {
			type: 'Point',
			coordinates: [
				30.34223048,
				59.93624285
			]
		}
		const updated = new Date()

		try {
			await users.insertOne({ _id, name, location, updated })
		} catch (err) {
			await users.updateOne({ _id }, { $set: { name, location, updated } } )
		}
		
	}

	async userData(_id, params={}) {
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

			await users.updateOne({ _id }, { $set: params })
		}

		const doc = await users.findOne(
			{ _id }, 
			{ projection: { _id: 0, status: 1, location: 1 } }
		)
		return doc
	}

	async getMovieData(input) {
		const movies = this.db.collection('movies')
		let movie_schema

		if ( Number(input) ) {
			movie_schema = await movies.findOne({ _id: Number(input) })
		} else {
			input = '"' + input.split(' ').join('" "') + '"'
			movie_schema = await movies.findOne({ 
				$text: { $search: input } 
			})
		}

		return movie_schema
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
				  	limit: 12,
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

		matched_cinemas.forEach((cinema) => {
			cinema.distance = Math.round(cinema.distance / 10) / 100
			cinema.schedule.sort((a, b) => {
				if (a.time <= '03:00' && b.time >= '03:00') return true
				else if (b.time <= '03:00' && a.time > '03:00') return false
				else if (a.time > b.time) return true
				else return false
			})
		})

		return matched_cinemas
	}

	async moviesList(id) {
	 	const movies = this.db.collection('movies')

	 	let most_popular = await movies.find({})
	 		.sort({'showcounts': -1}).limit(40)
	 		.project({ name: 1, rating: 1, genres: 1 }).toArray()

	 	let high_ranking = await movies.find({})
	 		.sort({'rating.kp': -1}).limit(40)
	 		.project({ name: 1, rating: 1, genres: 1 }).toArray()


	 	const cinemas = this.db.collection('cinemas')
	 	const { location } = await this.userData(id)
	 	const time = (new Date).toTimeString().slice(0, 5)

	 	async function goes_near(movie) {
	 		const name = movie.name.replace(/\./g, '[dot]')

	 		let cinemas_with_movie = await cinemas.aggregate([
	 			{
	 				$geoNear: {
	 					near: location,
	 					spherical: true,
	 					limit: 1,
	 					maxDistance: 25000,
 					  	query: { 
 							$or: [
 								{ [`schedule.${name}.time`]: { $gte: time } }, 
 								{ [`schedule.${name}.time`]: { $lte: '03:00' } }
 							]
 					  	},
 					  	distanceField: 'distance'
	 				}
	 			}
	 		]).toArray()

	 		return cinemas_with_movie.length ? true : false
	 	}

		most_popular = ( await most_popular.filter(goes_near) ).slice(0, 18)
		high_ranking = ( await high_ranking.filter(goes_near) ).slice(0, 18)

	 	return [most_popular, high_ranking]
	}	

	async cinemasNearby(id) {
		let { location: user_loc } = await this.userData(id)
		const cinemas = this.db.collection('cinemas')

		const nearest = await cinemas.aggregate([
			{
				$geoNear: {
				  	near: user_loc,
				  	spherical: true,
				  	limit: 24,
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

		nearest.forEach((cinema) => {
			cinema.distance = ( Math.round(cinema.distance / 10) ) / 100
		})

		return nearest
	}

	async saveInline(keyboards) {
		const inline = this.db.collection('inline')
		await inline.insertMany(keyboards)
	}

	async getInline(id) {
		const inline = this.db.collection('inline')
		const { keyboard } = await inline.findOne( ObjectID(id) )
		return keyboard
	}

}


module.exports = MongoDB