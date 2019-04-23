const ObjectID = require('mongodb').ObjectID

const Cook = {
	buttons_in_row: 2,

	previewMsg(movie_schema) {
		const { _id, name, age, directors, rating, poster } = movie_schema

		let msg = ''
		msg += `*"${name}"*`
		if (age) msg += `, _${age}_`
		if (directors) msg += `\n_Режиссер_: ${directors[0]}`

		if (rating && (rating.imdb || rating.kp)) {
			msg += '\n_Рейтинг_:'
			if (rating.imdb) msg += ` imdb - *${rating.imdb}* `
			if (rating.kp) msg += ` kp - *${rating.kp}*`
		}


		const options = {
			parse_mode: 'markdown',
			caption: msg,
			reply_markup: JSON.stringify({
				inline_keyboard: [
					[
						{ text: 'Трейлер', callback_data: `(trailer)[${_id}]` },
						{ text: 'Где посмотреть?', callback_data: `(schedule)[${_id}]` }
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
					keyboards.push({
						_id: ObjectID(),
						keyboard: inline_keyboard
					})
					inline_keyboard = []
				}
			})

			if (keyboards.length === 0) {
				keyboards.push({
					_id: ObjectID(),
					keyboard: inline_keyboard
				})
			}


			for (let [i, { keyboard }] of Object.entries(keyboards)) {
				let nav_bar = []
				for (let page in keyboards) {
					nav_bar.push({
						text: (page === i) ? `·${+page + 1}·` : `${+page + 1}`,
						callback_data: `(inline)[${keyboards[page]._id}]`
					})
				}
				keyboard.unshift(nav_bar)
			}


			const { keyboard: entry_keyboard } = keyboards[0]
			msg = '*Расписание на сегодня:*'
			options = {
				parse_mode: 'markdown',
				reply_markup: JSON.stringify({
					inline_keyboard: entry_keyboard
				})
			}

		}
		return [[msg, options], keyboards]
	},

	cinemaMsg(cinema) {
		const location = [
			cinema.location.coordinates[1],
			cinema.location.coordinates[0]
		]

		let address = ''
		if (cinema.metros) address += '🚇' + cinema.metros[0] + '\n'
		address += cinema.address
		if (cinema.telephone) address += '\n' + cinema.telephone

		const cinema_info = [...location, cinema.name, address]


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
				keyboards.push({
					_id: ObjectID(),
					keyboard: inline_keyboard
				})
				inline_keyboard = []
			}
		}

		if (inline_keyboard.length) {
			keyboards.push({
				_id: ObjectID(),
				keyboard: inline_keyboard
			})
		}

		for (let [i, { keyboard }] of Object.entries(keyboards)) {
			let nav_bar = []
			for (let page in keyboards) {
				nav_bar.push({
					text: (page === i) ? `·${+page + 1}·` : `${+page + 1}`,
					callback_data: `(inline)[${keyboards[page]._id}]`
				})
			}
			keyboard.unshift(nav_bar)
		}

		if (keyboards.length === 0) {
			inline_keyboard = [
				[{
					text: 'Ищущий да найдет',
					callback_data: '(null)'
				}],
				[{
					text: 'Но не здесь',
					callback_data: '(null)'
				}],
				[{
					text: 'Кинотеатр не работает🙁',
					callback_data: '(null)'
				}]
			]
			keyboards.push({ keyboard: inline_keyboard })
		}
		const { keyboard: entry_keyboard } = keyboards[0]

		const cinema_schedule = [
			'*Сегодня в кинотеатре:*',
			{
				parse_mode: 'markdown',
				reply_markup: JSON.stringify({
					inline_keyboard: entry_keyboard
				})
			}
		]

		return [cinema_info, cinema_schedule, keyboards]
	},

	nearestMsg(cinemas) {
		let keyboards = []
		let inline_keyboard = []
		let header


		for (let [ i, cinema ] of Object.entries(cinemas)) {
			const callback_data = `(cinema)[${cinema._id}]`
			let text = `${cinema.name} ~ ${cinema.distance} км`
			// if (cinema.metros) {
			// 	const metro = cinema.metros[0]
			// 		.replace(/ \/ .+/g, '')

			// 	text += `  (${metro})`
			// }

			inline_keyboard.push([{ text, callback_data }])

			if (inline_keyboard.length % 8 === 0 || i + 1 === cinemas.length) {
				keyboards.push({
					_id: ObjectID(),
					keyboard: inline_keyboard
				})
				inline_keyboard = []
			}
		}

		const { _id: header_id, keyboard: entry_keyboard } = keyboards[0]

		header = [{
			text: '·Поблизости·',
			callback_data: `(inline)[${header_id}]`
		}]

		for (let [i, { keyboard }] of Object.entries(keyboards)) {
			let nav_bar = []
			for (let page in keyboards) {
				nav_bar.push({
					text: (page === i) ? `·${+page + 1}·` : `${+page + 1}`,
					callback_data: `(inline)[${keyboards[page]._id}]`
				})
			}
			keyboard.unshift(header, nav_bar)
		}

		const msg = [
			'К твоим услугам:',
			{
				reply_markup:
					JSON.stringify({
						inline_keyboard: entry_keyboard
					})
			}
		]

		return [msg, keyboards]
	},

	programMsg(popular, high_rank) {
		function make_keyboards(movies) {
			let inline_keyboard = [], keyboards = []

			for (let movie of movies) {
				let info_block = ''
				if (movie.genres) info_block += movie.genres[0]
				if (movie.rating) {
					info_block += ', '
					if (movie.rating.kp) info_block += `kp - ${movie.rating.kp} `
					if (movie.rating.imdb) info_block += `imdb - ${movie.rating.imdb}`
				}


				inline_keyboard.push([
					{
						text: `— ${movie.name} —`,
						callback_data: `(movie)[${movie._id}]`
					}
				])

				inline_keyboard.push([
					{
						text: info_block,
						callback_data: '(null)'
					}
				])

				if (inline_keyboard.length === 8) {
					keyboards.push({
						_id: ObjectID(),
						keyboard: inline_keyboard
					})
					inline_keyboard = []
				}
			}

			if (inline_keyboard.length !== 0) {
				keyboards.push({
					_id: ObjectID(),
					keyboard: inline_keyboard
				})
			}

			return keyboards
		}

		function make_header(first_col, first_inline, second_col, second_inline) {
			return [
				{
					text: first_col,
					callback_data: `(inline)[${first_inline}]`
				},
				{
					text: second_col,
					callback_data: `(inline)[${second_inline}]`
				}
			]
		}

		function add_header_and_pages(keyboards, header) {
			for (let [i, { keyboard }] of Object.entries(keyboards)) {
				let nav_bar = []
				for (let page in keyboards) {
					nav_bar.push({
						text: (page === i) ? `·${+page + 1}·` : `${+page + 1}`,
						callback_data: `(inline)[${keyboards[page]._id}]`
					})
				}
				keyboard.unshift(header, nav_bar)
			}
		}

		const popular_keyboards = make_keyboards(popular)
		const rating_keyboards = make_keyboards(high_rank)

		const popular_header = make_header(
			'·Популярность·', popular_keyboards[0]._id,
			'Рейтинг', rating_keyboards[0]._id,
		)
		const rating_header = make_header(
			'Популярность', popular_keyboards[0]._id,
			'·Рейтинг·', rating_keyboards[0]._id,
		)

		add_header_and_pages(popular_keyboards, popular_header)
		add_header_and_pages(rating_keyboards, rating_header)

		const keyboards = [...popular_keyboards, ...rating_keyboards]

		const { keyboard: entry_keyboard } = keyboards[0]
		let program = [
			'С пылу с жару',
			{ reply_markup: JSON.stringify({ inline_keyboard: entry_keyboard }) }
		]

		return [program, keyboards]
	}

}

module.exports = Cook
