const ObjectID = require('mongodb').ObjectID

const Cook = {
	buttons_in_row: 2,

	previewMsg(movie_schema) {
		const { name, age, directors, rating, poster } = movie_schema

		let msg = ''
		msg += `*"${name}"*`
		if (age) msg += `, _${age}_`
		msg += `\n_Режиссер_: ${directors[0]}\n`

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
						{ text: 'Трейлер', callback_data: `(trailer)[${name.slice(0, 25)}]` },
						{ text: 'Где посмотреть?', callback_data: `(schedule)[${name.slice(0, 25)}]` }
					]
				]
			})
		}

		return [poster, options]
	},

	scheduleMsg(cinemas) {
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
						callback_data: `(cinema)[${cinema._id}]`
					} 
				])

				let sessions_block = []
				cinema.schedule.forEach((seance) => {
					sessions_block.push({ 
						text: `${seance.time}${seance.price ? ' ' + seance.price : ''}`,
						callback_data: '(null)'
				})
					if (sessions_block.length === this.buttons_in_row) {
						inline_keyboard.push(sessions_block)
						sessions_block = []
					}
				})

				if (sessions_block.length !== 0) {
					while (sessions_block.length !== this.buttons_in_row) {
						sessions_block.push({
							text: ' ',
							callback_data: '(null)'
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
						callback_data: `(inline)[${keyboards_id[page]}]`
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
	},

	cinemaMsg(cinema) {
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
				callback_data: `(movie)[${movie.slice(0, 25)}]`
			} ])

			let seances = []
			for (let seance of cinema.schedule[movie]) {
				seances.push({
					text: seance.time + (seance.price ? ' ' + seance.price : ' '),
					callback_data: '(null)'
				})

				if (seances.length === this.buttons_in_row) {
					inline_keyboard.push(seances)
					seances = []
				}
			}

			if (seances.length !== 0) {
				while (seances.length !== this.buttons_in_row) {
					seances.push({
						text: ' ',
						callback_data: '(null)'
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
					callback_data: `(inline)[${keyboards_id[page]}]`
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
	},

	nearestMsg(cinemas) {
		let keyboards = []
		let inline_keyboard = []

		const header = [{
			text: '● Поблизости',
			callback_data: '(null)'
		}]

		let pages = []
		for (let i = 1; i <= Math.ceil(cinemas.length / 6); i++) {
			pages.push({
				text: `${i}`,
				callback_data: `(inline)[${ObjectID()}]`
			})
		}

		for (let [ i, cinema ] of Object.entries(cinemas)) {
			if (inline_keyboard.length === 0) {
				let pages_with_state = pages.map((page) => {
					let state_page = { callback_data: page.callback_data }

					if (page.text == keyboards.length + 1) {
						state_page.text = `·${page.text}·`
					} else {
						state_page.text = page.text
					}

					return state_page
				})

				inline_keyboard.push(header, pages_with_state)
			}
			
			const callback_data = `(cinema)[${cinema._id}]`
			let text = `${cinema.name} ~ ${cinema.distance} км`
			if (cinema.metros) {
				const metro = cinema.metros[0]
					.replace(/ \/ .+/g, '')

				text += `  (${metro})`
			}
			
			inline_keyboard.push([{ text, callback_data }])

			if (inline_keyboard.length % 8 === 0 || i + 1 === cinemas.length) {
				keyboards.push(inline_keyboard)
				inline_keyboard = []
			}
		}

		const msg = [
			'К твоим услугам:', 
			{ 
				reply_markup: 
					JSON.stringify({ 
						inline_keyboard: keyboards[0] 
					}) 
			}
		]

		return [msg, keyboards]
	},

	programMsg(popular, high_rank) {
		let inline_keyboard = []
		
		inline_keyboard.push([{
			text:'● Сортировка по популярности',
			callback_data: '(null)'
		}])

		inline_keyboard.push([{
			text:'Сортировка по рейтингу',
			callback_data: '(null)'
		}])

		for (let movie of popular.slice(0, 6)) {
			let info_block = ''
			if (movie.genres) info_block += movie.genres[0] + ', '
			if (movie.rating.kp) info_block += `kp - ${movie.rating.kp} `
			if (movie.rating.imdb) info_block += `imdb - ${movie.rating.imdb}`

			inline_keyboard.push([
				{
					text: `— ${movie.name} —`,
					callback_data: `(movie)[${movie._id}]`
				},
				{
					text: info_block,
					callback_data: '(null)'
				}
			])
		}

		// inline_keyboard.push([{
		// 	text:'● Самый высокий рейтинг:',
		// 	callback_data: '(null)'
		// }])

		// for (let movie of high_rank) {
		// 	inline_keyboard.push([{
		// 		text: `— ${movie.name} ~ ${movie.rating.kp} —`,
		// 		callback_data: `(movie)[${movie._id}]`
		// 	}])
		// }

		return ['С пылу с жару', { reply_markup: JSON.stringify({ inline_keyboard }) }]
	}

}

module.exports = Cook