const { MongoClient, ObjectID } = require('mongodb')

function timeToGMT(offset = 0) {
	const date = new Date()
	let hours = date.getUTCHours() + offset
	if (hours > 23) hours = 24 - hours
	if (hours < 0) hours = 24 + hours
		return `${hours}:${date.getUTCMinutes()}`
}

function formatTime(time) {
	if (time >= '00:00' && time <= '02:30') {
		time = `${+time.slice(0, 2) + 24}${time.slice(2)}`
	}
	return time
}

class MongoDbInterface {
	constructor(url) {
		this.url = url
		this.name = 'bot-node'
		this.db = 'available after init'
	}

	async init() {
		try {
			this.client = new MongoClient(this.url, {useNewUrlParser: true})
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

		return await users.findOne(
			{_id},
			{projection: {_id: 0, status: 1, location: 1}}
		)
	}

	async getMovieData(input) {
		const movies = this.db.collection('movies')
		let movie_schema

		if ( +input ) {
			movie_schema = await movies.findOne({ _id: +input })
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
	 	const time = timeToGMT(3)

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
	 			let correct_name = movie_name.replace(/\[dot]/g, '.')
	 			if (movie_name !== correct_name) {
	 				schema.schedule[correct_name] = schema.schedule[movie_name]
	 				delete schema.schedule[movie_name]
	 				movie_name = correct_name
	 			}

	 			schema.schedule[movie_name] = schema.schedule[movie_name]
	 				.filter((seance) => formatTime(seance.time) >= formatTime(time))

	 			if (!schema.schedule[movie_name].length) {
	 				delete schema.schedule[movie_name]
				}
	 		})
	 	}

	 	return schema
	}

	async getSchedule(user_id, movie_id) {
		const { location: { coordinates: user_coord } } = await this.userData(user_id)
		const cinemas = this.db.collection('cinemas')

		let { name } = await this.getMovieData(movie_id)
		name = name.replace(/\./g, '[dot]')
		const time = timeToGMT(3)

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
					schedule: 1
				}
			}
		]).toArray()

		matched_cinemas.forEach((cinema) => {
			cinema.distance = Math.round(cinema.distance / 10) / 100
			cinema.schedule = cinema.schedule
				.filter( (seance) => formatTime(seance.time) >= formatTime(time) )
		})

		return matched_cinemas
	}

	async moviesList(id) {

		function goesNear(movie) {
			const name = movie.name.replace(/\./g, '[dot]')
			let current_time = timeToGMT(3)
			current_time = formatTime(current_time)

			for (let cinema of cinemas_near) {
				if (name in cinema.schedule && cinema.schedule[name].length) {
					const last_seance = formatTime(
						cinema.schedule[name].slice(-1)[0]
					)

					if (last_seance >= current_time) return true
				}
			}

			return false
		}


	 	const cinemas_near = await this.cinemasNearby(id)
	 	const movies = this.db.collection('movies')

	 	const popular_near = (await movies.find({})
	 		.sort({'showcounts': -1}).limit(30)
	 		.project({ name: 1, rating: 1, genres: 1 }).toArray())
	 		.filter(goesNear)
			.slice(0, 20)

	 	const high_ranking_near = (await movies.find({})
	 		.sort({'rating.kp': -1}).limit(30)
	 		.project({ name: 1, rating: 1, genres: 1 }).toArray())
	 		.filter(goesNear)
			.slice(0, 20)


	 	return [popular_near, high_ranking_near]
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
					distance: 1,
					schedule: 1
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


module.exports = MongoDbInterface
