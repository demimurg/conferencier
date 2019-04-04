require('dotenv').config()
const Telegraf = require('telegraf')
const MongoDB = require('./database/MongoDb')
const Cook = require('./formatting/msgView')

const bot = new Telegraf( process.env.token )
const db = new MongoDB( process.env.user_db_url )


bot.command('start', async (ctx) => {
	const id = ctx.update.message.from.id
	const { first_name, last_name } = ctx.update.message.from
	const name = last_name ? first_name + ' ' + last_name : first_name

	await db.addUser(id, name)

	const parse_mode = 'markdown'
	const reply_markup = JSON.stringify({
		keyboard: [
			[ { text: 'Кинотеатры' }, { text: 'Фильмы' } ],
			[ { text: 'Обновить местоположение', request_location: true } ]
		],
		resize_keyboard: true
	})
	ctx.reply('Привет новичок! '+ 
		'Бот *в процессе разработки*, ' + 
		'поэтому никто здесь с тобой сюсюкаться не будет. ' + 
		'Разбирайся с этим дерьмом сам🤨', { parse_mode, reply_markup })
})

bot.on('text', async (ctx) => {
	const id = ctx.message.from.id
	let input = ctx.message.text

	switch (input) {
		case 'Кинотеатры':
			const cinemas = await db.cinemasNearby(id)
			const [ nearest_view, keyboards ] = Cook.nearestMsg(cinemas)
			await db.saveInline(keyboards)

			ctx.reply(...nearest_view)
			break

		case 'Фильмы':
			const [ most_popular, high_ranking ] = await db.moviesList(id)
			const movies_program = Cook.programMsg(most_popular, high_ranking)

			ctx.reply(...movies_program)
			break
		
		default:
			if (input[0] === '/') input = Number(input.slice(1))

			const movie_schema = await db.getMovieData(input)
			if (movie_schema) {
				const preview = Cook.previewMsg(movie_schema)
				ctx.replyWithPhoto(...preview)
				return 
			}

			const cinema_schema = await db.getCinemaData(input)
			if (cinema_schema) {
				const [ cinema_info, cinema_schedule, keyboards ] = Cook.cinemaMsg(cinema_schema)
				await ctx.telegram.sendVenue(id, ...cinema_info)
				await ctx.reply(...cinema_schedule)

				await db.saveInline(keyboards)
				return
			}

			await ctx.reply('Фильм/кинотеатр не найден, сорьки')
	}
})

bot.on('callback_query', async (ctx) => {
	const id = ctx.callbackQuery.from.id	
	let type, doc_name

	type = ctx.callbackQuery.data
		.match(/\(.+\)/)[0]
		.slice(1, -1)

	if (type !== 'null') {
		doc_name = ctx.callbackQuery
			.data
			.match(/\[.+\]/)[0]
			.slice(1, -1)
	}
		
	switch (type) {
		
		case 'schedule':
			const cinemas = await db.getSchedule(id, doc_name)
			const [schedule, keyboards] = Cook.scheduleMsg(cinemas)
			if (keyboards) await db.saveInline(keyboards)

			ctx.reply(...schedule)
			break
		
		case 'trailer':
			const { trailer } = await db.getMovieData(doc_name)
			if (!trailer) {
				await ctx.reply('Увы и ах. Для этого фильма не нашлось трейлера')
			} else {
				trailer[0] === 'video' ? 
					ctx.replyWithVideo(trailer[1], { supports_streaming: true }) :
					ctx.reply(`[есть только на ютупчике](${trailer[1]})`, { parse_mode: 'markdown' })
			}
			break
		
		case 'cinema':
			const cinema_object = await db.getCinemaData(Number(doc_name))
			const [ cinema_info, cinema_schedule, cinema_keyboards ] = Cook.cinemaMsg(cinema_object)
			await db.saveInline(cinema_keyboards)

			await ctx.telegram.sendVenue(id, ...cinema_info)
			await ctx.reply(...cinema_schedule)
			break
		
		case 'movie':
			const movie_schema = await db.getMovieData(doc_name)
			const preview = Cook.previewMsg(movie_schema)

			ctx.replyWithPhoto(...preview)
			break

		case 'inline':
			const { keyboard } = await db.getInline(doc_name)
			const reply_markup = { inline_keyboard: keyboard }
			
			try {
				await ctx.editMessageReplyMarkup(reply_markup)
				await ctx.answerCbQuery(' ')
			} catch (err) {
				await ctx.answerCbQuery('Ты уже на этой странице')
			}

			break

		default:
			let msg = [
				'В глаз себе потыкай ❤️',
				'тыц'
			][ Math.round( Math.random() ) ]

			await ctx.answerCbQuery(msg)

	}
})

bot.on('location', async (ctx) => {
	const id = ctx.update.message.from.id
	const location = ctx.update.message.location

	await db.userData(id, { location })
	if (id == 199941625) ctx.reply('Дима - мудожопа. Сосни хуйцов!')

	ctx.reply('Местоположение обновлено!')
})


process.on('launch', async () => {
	try {
		await db.init()
		console.log('База данных подключена')
	} catch (err) {
		console.log(err)
		process.exit()
	}

	bot.catch((err) => console.log(err))
	bot.launch()
})
process.on('SIGINT', async () => {
	console.log('\nCоединение с базой данных разорвано')
	await db.close()
	process.exit()
})
process.emit('launch')