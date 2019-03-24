require('dotenv').config()
const Telegraf = require('telegraf')
const MongoDB = require('./database/MongoDb')

const bot = new Telegraf( process.env.token )
const db = new MongoDB( process.env.db_url )

const delay = (ms) => new Promise( (res) => setTimeout(res, ms) )
const minutesPast = (last_date) => Math.round( (new Date() - last_date) / 60000 )


process.on('launch', async () => {
	await db.init()
	console.log('База данных подключена')
})
process.on('SIGINT', async () => {
	console.log('\nСоединение с базой данных разорвано')
	await db.close()
	process.exit()
})
process.emit('launch')


bot.command('test', async (ctx) => {
	ctx.reply('☑️')
})

bot.command('start', async (ctx) => {
	const id = ctx.update.message.from.id
	let { first_name, last_name } = ctx.update.message.from
	const name = last_name ? first_name + ' ' + last_name : first_name

	await db.addUser(id, name)

	const reply_markup = JSON.stringify({
		keyboard: [
			[ { text: 'Кинотеатры' }, { text: 'В прокате' } ],
			[ { text: 'Обновить местоположение', request_location: true } ]
		],
		resize_keyboard: true
	})
	await ctx.reply('Привет новичок! '+ 
		'Бот *в процессе разработки*, ' + 
		'поэтому никто здесь с тобой сюсюкаться не будет. ' + 
		'Разбирайся с этим дерьмом сам🤨', { parse_mode: 'markdown' })
})

bot.on('text', async (ctx) => {
	const id = ctx.message.from.id
	let input = ctx.message.text

	switch (input) {
		case 'Кинотеатры':
			const cinemas = await db.cinemasNearby(id)
			let nearest_view = formNearestMsg(cinemas)

			ctx.reply(...nearest_view)
			break

		case 'В прокате':
			const [most_popular, high_ranking] = await db.moviesList()
			let movies_program = formProgramMsg(most_popular, high_ranking)

			ctx.reply(...movies_program)
			break
		
		default:
			if (input[0] === '/') input = Number(input.slice(1))

			const movie_schema = await db.getMovieData(input)
			if (movie_schema) {
				const preview = await formPreviewMsg(movie_schema)
				await ctx.replyWithPhoto(...preview)
				return 
			}

			const cinema_schema = await db.getCinemaData(input)
			if (cinema_schema) {
				const [ cinema_info, cinema_schedule ] = formCinemaMsg(cinema_schema)

				await ctx.telegram.sendVenue(id, ...cinema_info)
				await ctx.reply(...cinema_schedule)
				return
			}

			await ctx.reply('Фильм/кинотеатр не найден, сорьки')
	}
})

bot.on('callback_query', async (ctx) => {
	const id = ctx.callbackQuery.from.id
	
	const type = ctx.callbackQuery
		.data
		.match(/\(.+\)/)[0]
		.slice(1, -1)

	const doc_name = ctx.callbackQuery
		.data
		.match(/".+"/)[0]
		.slice(1, -1)


	switch (type) {
		
		case 'schedule':
			const cinemas = await db.getSchedule(id, doc_name)
			const schedule = await formScheduleMsg(cinemas)	

			await ctx.reply(...schedule)
			break
		
		case 'trailer':
			const { trailer } = await db.getMovieData(doc_name)
			if (!trailer) return

			trailer[0] === 'video' ? 
				await ctx.replyWithVideo(trailer[1], { supports_streaming: true }) :
				await ctx.reply(`[есть только на ютупчике](${trailer[1]})`, { parse_mode: 'markdown' })
			break
		
		case 'cinema':
			const cinema_object = await db.getCinemaData(Number(doc_name))
			const [ cinema_info, cinema_schedule ] = formCinemaMsg(cinema_object)

			await ctx.telegram.sendVenue(id, ...cinema_info)
			await ctx.reply(...cinema_schedule)
			break
		
		case 'movie':
			const movie_schema = await db.getMovieData(doc_name)
			const preview = await formPreviewMsg(movie_schema)
			await ctx.replyWithPhoto(...preview)
			break

		default:
			await ctx.answerCbQuery('В глаз себе потыкай❤️')

	}
})


bot.on('location', async (ctx) => {
	const id = ctx.update.message.from.id
	let location = ctx.update.message.location

	await db.userData(id, { location })
	await ctx.reply('*Местоположение обновлено*.\n' + 
		'Продам его фейсбуку и заработаю кучу бабок. Шутка',
		{ parse_mode: 'markdown' })
})


function formPreviewMsg(movie_schema) {
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


function formScheduleMsg(cinemas) {
	let msg, options
	if (cinemas.length === 0) {
		msg = 'В кинотетрах поблизости *нет сеансов*. Я скорблю вместе с тобой'
		options = { parse_mode: 'markdown' }
	} else {
		let inline_keyboard = []

		cinemas.forEach((cinema) => {
			cinema.distance = Math.round(cinema.distance / 10) / 100
			cinema.schedule.sort((a, b) => {
				if (a.time <= '03:00' && b.time >= '03:00') return true
				else if (b.time <= '03:00' && a.time > '03:00') return false
				else if (a.time > b.time) return true
				else return false
			})
			
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
		})

		msg = '*Расписание на сегодня:*'
		options = {
			parse_mode: 'markdown',
			reply_markup: JSON.stringify({
				inline_keyboard
			})
		}

	}
	return [msg, options]
}


function formCinemaMsg(cinema) {
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
			`${cinema.address} ${cinema.telephone}` :
			cinema.address
	)
	cinema_info.push({ 'foursquare_type': 'arts_entertainment/cinema' })

	let inline_keyboard = []
	for (let movie in cinema.schedule) {
		inline_keyboard.push([ {
			text: movie,
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
	}

	const cinema_schedule = [ 
		'*Сегодня в кинотеатре:*',  
		{	
			parse_mode: 'markdown',
			reply_markup: JSON.stringify( { inline_keyboard } ) 
		} 
	]

	return [cinema_info, cinema_schedule]
}

function formNearestMsg(cinemas) {
	let msg = ''
	msg += '🎦*Кинотеатры рядом с тобой:*\n'

	for (let cinema of cinemas) {
		cinema.distance = ( Math.round(cinema.distance / 10) ) / 100
		msg += `\n● ${cinema.name} ~ ${cinema.distance} км`
		msg += `\n(_${cinema.metros[0]}_) `
		msg += '/' + cinema._id + '\n'

	}

	return [msg, { parse_mode: 'markdown' }]

}

function formProgramMsg(popular, high_rank) {
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





bot.catch((err) => console.log(err))
bot.launch()

