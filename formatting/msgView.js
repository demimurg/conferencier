const ObjectID = require('mongodb').ObjectID

class Cook {
	static previewMsg(movie_schema) {
		const { name, genre, age, director, rating, poster} = movie_schema

		let msg = ''
		msg += `*"${name}"*`
		if (age) msg += `, _${age}_`
		msg += `\n_Режиссер_: ${director[0]}\n`

		if (rating) {
			msg += '_Рейтинг_:'
			if (rating.imdb) msg += ` imdb - *${rating.imdb}* `
			if (rating.kp) msg += ` kp - *${rating.kp}*`
		}


		const options = {
			parse_mode: 'markdown',
			caption: msg,
			reply_markup: JSON.stringify({
				inline_keyboard: [
					[
						{ text: 'Трейлер', callback_data: `(trailer)"${name.slice(0, 25)}"` },
						{ text: 'Где посмотреть?', callback_data: `(schedule)"${name.slice(0, 25)}"` }
					]
				]
			})
		}

		return [poster, options]
	}

	static nearestMsg(cinemas) {
		let msg = ''
		msg += '*Кинотеатры рядом с тобой:*\n'

		for (let cinema of cinemas) {
			cinema.distance = ( Math.round(cinema.distance / 10) ) / 100
			msg += `\n● ${cinema.name} ~ ${cinema.distance} км`
			if (cinema.metros.length) msg += `\n(_${cinema.metros[0]}_) `
			msg += '/' + cinema._id + '\n'

		}

		return [msg, { parse_mode: 'markdown' }]
	}

	static programMsg(popular, high_rank) {
		let msg = '*Самые популярные фильмы:*'

		for (let movie of popular) {
			msg += `\n● ${movie.name} (/${movie._id})`
			if (movie.rating) msg += ` - *${movie.rating.kp || movie.rating.imdb}*`
		}

		msg += '\n\n*Самый высокий рейтинг:*'

		for (let movie of high_rank) {
			msg += `\n● ${movie.name} (/${movie._id})`
			if (movie.rating) msg += ` - *${movie.rating.kp || movie.rating.imdb}*`
		}

		return [msg, { parse_mode: 'markdown' }]
	}

	static scheduleMsg(cinemas) {
		let msg, options, keyboards
		if (cinemas.length === 0) {
			msg = 'В кинотетрах поблизости *нет сеансов*. Я скорблю вместе с тобой'
			options = { parse_mode: 'markdown' }
		} else {
			keyboards = []
			let inline_keyboard = []

			cinemas.forEach((cinema) => {			
				inline_keyboard.push([ 
					{ 
						text: `${cinema.name} ~ ${cinema.distance} км`,
						callback_data: `(cinema)"${cinema._id}"`
					} 
				])

				let sessions_block = []
				cinema.schedule.forEach((seance) => {
					sessions_block.push({ 
						text: `${seance.time}${seance.price ? ' ' + seance.price : ''}`,
						callback_data: 'null'
				})
					if (sessions_block.length === 3) {
						inline_keyboard.push(sessions_block)
						sessions_block = []
					}
				})

				if (sessions_block.length !== 0) {
					while (sessions_block.length !== 3) {
						sessions_block.push({
							text: ' ',
							callback_data: 'null'
						})
					}
					inline_keyboard.push(sessions_block)
				}

				if (inline_keyboard.length >= 8) {
					keyboards.push(inline_keyboard)
					inline_keyboard = []
				}
			})

			if (keyboards.length === 0) keyboards.push(inline_keyboard)

			let keyboards_id = []
			for (let _ of keyboards) {
				keyboards_id.push( ObjectID() )
			}

			for (let [i, keyboard] of Object.entries(keyboards)) {
				let nav_bar = []
				for (let page in keyboards) {
					nav_bar.push({ 
						text: (page === i) ? `·${Number(page) + 1}·` : `${Number(page) + 1}`,
						callback_data: `(inline)"${keyboards_id[page]}"`
					})
				}
				keyboard.unshift(nav_bar)
			}


			msg = '*Расписание на сегодня:*'
			options = {
				parse_mode: 'markdown',
				reply_markup: JSON.stringify({
					inline_keyboard: keyboards[0]
				})
			}

		}
		return [[msg, options], keyboards]
	}

	static cinemaMsg(cinema) {
		let cinema_info = []

		cinema_info.push(
			cinema.location.coordinates[1], 
			cinema.location.coordinates[0]
		)
		cinema_info.push(
			cinema.metros[0] ?
				cinema.name + '  🚇' + cinema.metros[0] :
				cinema.name
		)
		cinema_info.push(
			cinema.telephone ? 
				`${cinema.address}\n${cinema.telephone}` :
				cinema.address
		)
		cinema_info.push({ 'foursquare_type': 'arts_entertainment/cinema' })

		let keyboards = []
		let inline_keyboard = []
		for (let movie in cinema.schedule) {
			inline_keyboard.push([ {
				text: '— ' + movie + ' —',
				callback_data: `(movie)"${movie.slice(0, 25)}"`
			} ])

			let seances = []
			for (let seance of cinema.schedule[movie]) {
				seances.push({
					text: seance.time + (seance.price ? ' ' + seance.price : ' '),
					callback_data: '(null)"null"'
				})

				if (seances.length === 3) {
					inline_keyboard.push(seances)
					seances = []
				}
			}

			if (seances.length !== 0) {
				while (seances.length !== 3) {
					seances.push({
						text: ' ',
						callback_data: '(null)"null"'
					})
				}
				inline_keyboard.push(seances)
			}

			if (inline_keyboard.length >= 8) {
				keyboards.push(inline_keyboard)
				inline_keyboard = []
			}
		}
		if (keyboards.length === 0) keyboards.push(inline_keyboard)

		let keyboards_id = []
		for (let _ of keyboards) {
			keyboards_id.push( ObjectID() )
		}

		for (let [i, keyboard] of Object.entries(keyboards)) {
			let nav_bar = []
			for (let page in keyboards) {
				nav_bar.push({ 
					text: (page === i) ? `·${Number(page) + 1}·` : `${Number(page) + 1}`,
					callback_data: `(inline)"${keyboards_id[page]}"`
				})
			}
			keyboard.unshift(nav_bar)
		}

		const cinema_schedule = [ 
			'*Сегодня в кинотеатре:*',  
			{	
				parse_mode: 'markdown',
				reply_markup: JSON.stringify({ 
					inline_keyboard: keyboards[0]
				}) 
			} 
		]

		return [cinema_info, cinema_schedule, keyboards]
	}
}

module.exports = Cook