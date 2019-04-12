require('dotenv').config() 
const axios = require('axios');
const cheerio = require('cheerio');
const MongoClient = require('mongodb').MongoClient;


let Errors = {
	date: new Date(),
	shit_happens: [],
	add(type, movie) {
		for (let err of this.shit_happens) {
			if (err.type == type) {
				err.content.push(movie)
				return
			}
		}
		this.shit_happens.push({ type, content: [movie] })
	}
}

const Parser = {
	array_from(block, $) {
		const array = block
			.map( (i, elem) => $(elem).text().trim() )
			.get()

		return (array.length) ? array : null
	},

	parse_and_form_schedule(item) {
	    let $ = cheerio.load(item)
	    const seances = item.children()
	    let movie_schedule = []

	    let current_format
	    seances.each((i, elem) => {
	        if (elem.tagName === 'span') {
	            current_format = $(elem).text()
	        } else {
	            let time = $(elem).find('.session_time').text().trim()
	            let price = $(elem).find('.session_price').text()
	            let format = current_format

	            let ceil
	            if (price) {
	            	price = price.match(/\d+/)[0] + '₽'
	            	ceil = { time, price, format }
	            } else {
	            	ceil = { time, format }
	            }

	            movie_schedule.push(ceil)
	        }
	    })

	    return movie_schedule
	},

	getLinks(data) {
		const $ = cheerio.load(data)
		const links = $('.theater_name')
			.map((i, elem) => $(elem).attr('href'))
			.get()

		return links
	},

	makeCinemaSchema(data) {
		let $ = cheerio.load(data)

	    const name = $('.grid').find('h1').text()
	    const metros = this.array_from($('.metro'), $)
	    const address = $('span[itemprop="address"]').text().trim()
	    const telephone = $('.theaterInfo_phone').text()

	    const coords = [ $('meta[itemprop="longitude"]').attr('content'), 
	    				 $('meta[itemprop="latitude"]').attr('content') ]
	    const location = { type: 'Point', 
	    				   coordinates: coords.map(coord => +coord ) }

	    let schedule = {}, movie_links = []
	    const movie_items = $('.showtimes_item.fav-film').toArray()
	    for (let item of movie_items) {
	        const movie_name = $(item)
	        	.find('.films_name')
	        	.text()
	        	.replace(/\./g, '[dot]')
	        
	        const movie_link = 'https://' + 
	        	$(item).find('.films_right')
	        		.find('a').attr('href')
	        		.match(/kinoafisha.+/)[0]


	        const schedule_block = $(item).find('.showtimes_cell').eq(1)
	        schedule[movie_name] = this.parse_and_form_schedule(schedule_block)
	        movie_links.push(movie_link)
	    }

	    let schema = {
	        name,
	        metros,
	        address,
	        location,
	        telephone,
	        schedule,
	        movie_links
	    }

	    for (let field in schema) {
	    	if (!schema[field]) delete schema[field]
	    }

	    return schema
	},

	makeMovieSchema(data) {		
	    let $ = cheerio.load(data)

	    const name = $('meta[property="og:title"]').attr('content').trim().slice(0, -7)
	    const directors = this.array_from($('.movieInfoV2_producerBadge'), $)
	    const poster = $('.movieInfoV2_posterImage').attr('src')

	    let schema = {
	        name,
	        directors,
	        poster
	    }


	    try {
	        let trailer = JSON.parse($('.combinedPlayer').attr('data-param'))
	        if (trailer.youtube === undefined) {
	        	schema['trailer'] = ['video', trailer.files.low.path]
	        } else {
	        	schema['trailer'] = ['youtube', trailer.youtube]
	        }
	    } catch(err) {
	    	Errors.add('На киноафише нет трейлера', name)
	    }

	    for (let field in schema) {
	    	if (!schema[field]) delete schema[field]
	    }

	    return schema
	}
}

const Kinoafisha = {
	request_options: {
		headers: {
			'Accept': 'text/plain',
			'User-Agent': 'Mozilla/5.0 (Macintosh; ' + 
				'Intel Mac OS X 10_14_4) AppleWebKit/605.1.15 ' + 
				'(KHTML, like Gecko) Version/12.1 Safari/605.1.15'
		}
	},

	async getCinemaLinks() {
		let cities = ['spb']
		let cinema_links = []

		for (let city of cities) {
			const { data } = await axios.get(
				`https://${city}.kinoafisha.info/cinema/`, 
				this.request_options
			)
			cinema_links = Parser.getLinks(data) 
		
		}

     	return cinema_links
     		// .slice(0, 10)
	},

	async getCinemasData() {
		const cinema_links = await this.getCinemaLinks()
		let cinemas = [], movie_showcounts = {}, all_movie_links = new Set()

		for (let cin_link of cinema_links) {
			const { data } = await axios.get(cin_link, this.request_options)
			let { movie_links, ...cinema } = Parser.makeCinemaSchema(data)
			
			cinema._id = +cin_link.match(/\d+/)[0]
			cinemas.push(cinema)

			for (let mov_link of movie_links) {
				movie_showcounts[mov_link] ?
					movie_showcounts[mov_link]++ :
					movie_showcounts[mov_link] = 1

				all_movie_links.add(mov_link)
			}
		}

		return { cinemas, all_movie_links, movie_showcounts }
	},

	async getMoviesData(movie_links, movie_showcounts) {
		let movies = []

		for (let link of movie_links) {
		    const { data } = await axios.get(link, this.request_options)

		    let movie = Parser.makeMovieSchema(data)
		    movie._id = +link.match(/\d+/)[0]
		    movie.showcounts = movie_showcounts[link]

		    movies.push(movie)

		}
		return movies
	}
}

const Extra = {
	request_options: {
		headers: {
			'X-Requested-With': 'XMLHttpRequest',
			'Accept': 'application/json'
		}
	},

	async getMoviesFromKinopoisk() {
		const kp_url = 'https://www.kinopoisk.ru/api/afisha/films/?limit=15'

		const documents_total = (await axios.get(kp_url, this.request_options))
			.data
			.pagination
			.total

		let kinopoisk_movies = []
		let batch_number = 0
		let batch_url, items

		do {
		  batch_url = kp_url + `&offset=${batch_number * 15}`
		  items = (await axios.get(batch_url, this.request_options)).data.items

		  kinopoisk_movies.push(...items)
		  batch_number++
		} while (items.length)

		Errors.add('Кинопоиск отдал не все файлы', 
			`${documents_total} - найдено. ${kinopoisk_movies.length} - получено.`)


		kinopoisk_movies = kinopoisk_movies.map((movie) => {

			let schema = {
				name: movie.title.trim(),
				original_name: movie.originalTitle,
				year: movie.year,
				genres: movie.genres,
				countries: movie.countries,
				duration: +movie.duration,
				rating: +movie.ratings.kp.value,
				poster: 'https:' + movie.img.posterSmall.x1
			}

			for (let field in schema) {
	  			if (!schema[field]) delete schema[field]
	  		}

	  		return schema
		})

	  	return kinopoisk_movies
	},

	async getMoviesFromKinohod() {
		const kh_url = 'https://kinohod.ru/api/rest/site/v1/movies/?sort=showcount'
	  
	  	let { data: kinohod_movies } = await axios.get(kh_url, this.request_options)

	  	kinohod_movies = kinohod_movies.map((movie) => {
	  		try {
		  		var poster = movie.posterLandscape.name
		  		poster = 'https://st2.kinohod.ru/c/600x320/' + 
		  			`${poster.slice(0, 2)}/${poster.slice(2, 4)}/${poster}`

		  		var trailer = movie.trailers[0].mobile_mp4.filename
		  		trailer = 'https://kinohod.ru/o/' +
		  			`${trailer.slice(0, 2)}/${trailer.slice(2, 4)}/${trailer}`
		  		trailer = ['video', trailer]

		  	} catch (err) {
		  		Errors.add('На киноходе нет трейлера', movie.title)
		  	}
	  		
	  		let schema = {
	  			name: movie.title.trim(),
	  			duration: +movie.duration,
	  			age: movie.ageRestriction,
	  			kinohod_showcounts: +movie.countScreens,
	  			rating: +movie.imdb_rating,
	  			poster, trailer
	  		}

	  		for (let field in schema) {
	  			if (!schema[field]) delete schema[field]
	  		}

	  		return schema
	  	})

	  	return kinohod_movies
	},

	async completeMoviesData(movies) {
		const kp_movies = await this.getMoviesFromKinopoisk()
		const kh_movies = await this.getMoviesFromKinohod()

		function unify(name) {
			return name
				.toLowerCase()
				.replace(/ё/g, 'е')
				.replace(/[^a-zа-я]/g, '')
				// .replace(/[.,…"':«»-\s]/g, '')
		}

		movies.forEach((movie) => {
			let kp_matched = false, kh_matched = false

			let name_unify
			if (!movie.name) {
				console.log(movie)
				return
			} else {
				name_unify = unify(movie.name)
			}

			for (let kp_mov of kp_movies) {
				if ( kp_mov.name && name_unify === unify(kp_mov.name) ) {
					delete kp_mov.name
					kp_mov.rating = { kp: kp_mov.rating }

					Object.assign(movie, kp_mov)
					kp_matched = true
					break
				}
			}

			for (let kh_mov of kh_movies) {
				if ( kh_mov.name && name_unify === unify(kh_mov.name) ) {
					delete kh_mov.name
					kh_mov.rating = movie.rating ? 
						{ kp: movie.rating.kp, imdb: kh_mov.rating } :
						{ imdb: kh_mov.rating }
					
					Object.assign(movie, kh_mov)
					kh_matched = true
					break
				}
			}


			if (!kp_matched) Errors.add('На кинопоиске нет фильма', movie.name)
			if (!kh_matched) Errors.add('На киноходе нет фильма', movie.name)	
		})

		for (let kp_mov of kp_movies) {
			if (kp_mov.name) {
				Errors.add('Не использованные фильмы кинопоиска', kp_mov.name)
			}
		}

		for (let kh_mov of kh_movies) {
			if (kh_mov.name) {
				Errors.add('Не использованные фильмы кинохода', kh_mov.name)
			}
		}
	}
}


const DB = {
	async cleanPush(movies, cinemas, url) {
		const client = await MongoClient.connect(url, { useNewUrlParser: true })
		const db = await client.db('bot-node')


		if (await db.collection('cinemas').findOne({}) != null) {
			await db.collection('cinemas').drop()
			await db.collection('movies').drop()
		}
		await db.collection('cinemas').insertMany(cinemas)
		await db.collection('movies').insertMany(movies)

		delete Errors['add']
		await db.collection('errors').insertOne(Errors)

		await db.collection('movies').createIndex({ name: 'text' })
		await db.collection('cinemas').createIndex({ name: 'text' })
		await db.collection('cinemas').createIndex( { location: "2dsphere" } )
		
		await client.close()
	}
}



;(async function update() {
	const { cinemas, all_movie_links, movie_showcounts } = await Kinoafisha.getCinemasData()
	console.log('Информация о кинотеатрах загружена')
	let movies = await Kinoafisha.getMoviesData(all_movie_links, movie_showcounts)
	console.log('Информация по фильмам тоже')

	await Extra.completeMoviesData(movies)
	console.log('Подгрузили информацию с кинохода и кинопоиска')
	await DB.cleanPush(movies, cinemas, process.env.FILL_DB_URL)
	console.log('База данных обновлена!')

})().catch(err => console.log(err))