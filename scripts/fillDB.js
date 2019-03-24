const axios = require('axios');
const cheerio = require('cheerio');
const MongoClient = require('mongodb').MongoClient;
// const status = require('node-status')

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

class Loader {
	static async getCinemas() {
    	let $

    	const { data: spb_cinemas_page } = await axios
    		.get('https://spb.kinoafisha.info/cinema/')
    		.catch((err) => axios.get('https://spb.kinoafisha.info/cinema/'))

    	$ = cheerio.load(spb_cinemas_page)
    	const spb_hrefs = $('.theater_name')
        	.map((i, elem) => $(elem).attr('href'))
        	.get()

    	// const { data: msk_cinemas_page } = await axios
    	// 	.get('https://msk.kinoafisha.info/cinema/')
    	// 	.catch((err) => axios.get('https://msk.kinoafisha.info/cinema/'))

     //    $ = cheerio.load(msk_cinemas_page)
    	// const msk_hrefs = $('.theater_name')
     //    	.map((i, elem) => $(elem).attr('href'))
     //    	.get()

     //    return [...msk_hrefs, ...spb_hrefs]
     	return spb_hrefs
	}


	static async getMovieRatings() {
		const kp_url = 'https://www.kinopoisk.ru/api/afisha/films/?limit=15'
		const headers = { 'X-Requested-With': 'XMLHttpRequest' }

		const documents_total = (await axios.get(kp_url, { headers }))
			.data
			.pagination
			.total



		let movie_objects = []
		let batch_number = 0
		let batch_url, items

		do {
		  batch_url = kp_url + `&offset=${batch_number * 15}`
		  items = (await axios.get(batch_url, { headers })).data.items

		  movie_objects.push(...items)
		  batch_number++
		} while (items.length)


		Errors.add('Кинопоиск отдал не все файлы', 
			`${documents_total} - найдено. ${movie_objects.length} - получено.`)


		let ratings = {}
	  	for (let movie of movie_objects) {
	  		if (movie.title) {
	  			ratings[movie.title] = {
	  				link: `https://rating.kinopoisk.ru/${movie.id}.xml`,
	  				kp_rating: Number(movie.ratings.kp.value)
	  			}
	  		}
	  	}
	  	return ratings
	}
}


class Parser {
	static str_to_array(str) {
	    let formated = str
			.replace(/([а-я])([А-Я])/g, '$1, $2')
			.replace(/(США)([А-Я])/g, '$1, $2')
	    let arr =  formated.split(', ')

	    return arr
	}

	static parse_and_form_schedule(item) {
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
	}



	static async getCinemasData() {
		const cinemas_href = await Loader.getCinemas()
		let cinemas = [], movies_showcount = {}, movies_href = new Set()

		for (let href of cinemas_href) {
			try { 
				var { data: cinema_page } = await axios.get(href)
			} catch (err) {
				console.log(err)
				continue
			}

		    let $ = cheerio.load(cinema_page)

		    const _id = Number( href.match(/\d+/)[0] )
		    const name = $('.grid').find('h1').text()
		    const metros = this.str_to_array( $('.metro').text() )
		    const address = $('span[itemprop="address"]').text().trim()
		    const telephone = $('.theaterInfo_phone').text()

		    const coords = [ $('meta[itemprop="longitude"]').attr('content'), 
		    				 $('meta[itemprop="latitude"]').attr('content') ]
		    const location = { type: 'Point', 
		    				   coordinates: coords.map(coord => Number(coord)) }

		    let schedule = {}
		    const movie_items = $('.showtimes_item.fav-film').toArray()
		    for (let item of movie_items) {
		        let movie_name = $(item).find('.films_name').text()
		        let movie_href = $(item).find('.films_right').find('a').attr('href')
		        movie_href = 'https://' + movie_href.match(/kinoafisha.+/)[0]
		        if (movie_name === 'Vox Lux')  movie_name = 'Вокс люкс'

		        const schedule_block = $(item).find('.showtimes_cell').eq(1)
				const correct_name = movie_name.replace(/\./g, '[dot]')
		        schedule[correct_name] = this.parse_and_form_schedule(schedule_block)
		        movies_href.add(movie_href)


		        movies_showcount[movie_name] ? 
		        	movies_showcount[movie_name]++ : movies_showcount[movie_name] = 1

		    }

		    cinemas.push({
		        _id,
		        name,
		        metros,
		        address,
		        location,
		        telephone,
		        schedule
		    })
		}

		return { cinemas, movies_href, movies_showcount }
	}


	static async getMoviesData(movies_href, movies_showcount) {
		const ratings = await Loader.getMovieRatings()
		let movies = []

		for (let href of movies_href) {
			try {
		    	var {data: movie_page} = await axios.get(href)
		    } catch (err) {
		    	console.log(err)
		    	continue
		    }

		    let $ = cheerio.load(movie_page)

		    const _id = Number( href.match(/\d+/)[0] )
		    let name = $('.movieInfo_main.grid_cell8').find('h1').text().trim().slice(0, -6)
		    const original_name = $('span[itemprop="alternativeHeadline"]').text().trim()
		    const genre = $('a[itemprop="genre"]').text().trim()
		    const country = this.str_to_array( $('span[itemprop="countryOfOrigin"]').text() )
		    const director = this.str_to_array( $('span[itemprop="director"]').text() )
		    const duration = $('span[itemprop="duration"]').text()
		    const actors = this.str_to_array( $('span[itemprop="actor"]').text() )
		    const poster = $('.movieInfo_posterImage').attr('src')

		    name == 'Vox Lux' ? name = 'Вокс люкс' : name
		    const showcounts = movies_showcount[name]


		    let schema = {
		        _id,
		        name,
		        original_name,
		        genre,
		        country,
		        director,
		        duration,
		        actors,
		        showcounts,
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

		    
		    let name_in_ratings
		    if (ratings[name]) {
		        name_in_ratings = name
		    } else {
		        for (let movie in ratings) {		
					const name_begin = name
						.toLowerCase()
						.replace(/ё/g, 'е')
						.match(/[а-я]+|[a-z]+/)[0]
					

	                const movie_begin = movie
	                	.toLowerCase()
	                	.replace(/ё/g, 'е')
	                	.match(/[а-я]+|[a-z]+/)[0]

	                if (name_begin === movie_begin) {
	                    name_in_ratings = movie
	                }
		        }
		    }

		    if (name_in_ratings) {
		    	const { data: rating_xml } = await axios.get(ratings[name_in_ratings].link)
		    	const imdb_regexp = />(\d+|\d+\.\d+)<\/imdb_rating/g

		    	let imdb = imdb_regexp.exec(rating_xml)
		    	imdb = imdb ? Math.round(Number(imdb[1]) * 10) / 10 : imdb
		    	let kp = ratings[name_in_ratings].kp_rating

		    	if (kp || imdb) {
		    		schema.rating = {}
		    		if (kp) schema.rating.kp = (kp.length === 1) ? kp + '.0' : kp
		    		if (imdb) schema.rating.imdb = (imdb.length === 1) ? imdb + '.0' : imdb
		    	}
		    } else {
		    	Errors.add('Кинопоиск не нашел рейтинг для фильма', name)
		    }

		    movies.push(schema)
		}
		return movies
	}
}


class Extra {
	static async modifySomeDataInto(movies) {
		const kh_url = 'https://kinohod.ru/api/rest/site/v1/movies/?sort=showcount'
		const headers = { 
			'X-Requested-With': 'XMLHttpRequest',
			'Accept': 'application/json'
	  	}
	  
	  	const { data: kinohod_movies } = await axios.get(kh_url, { headers })

	  	for (let db_mov of movies) {
	  		let matched = false
	  		const title_chars = db_mov
	  			.name
	  			.replace(/ё/g, 'е')
	  			.toLowerCase()
	  			.match(/[a-я]+/g)

	  		for (let kh_mov of kinohod_movies) {
	  			const kh_title = kh_mov.title.toLowerCase()
	  			if ( title_chars.every((char) => kh_title.includes(char)) ) {
	  				matched = true

			  		try {
		  				db_mov['age'] = kh_mov.ageRestriction
			
				  		let kh_poster = kh_mov.posterLandscape.name
				  		kh_poster =	
				  			'https://st2.kinohod.ru/c/600x320/' + 
				  			`${kh_poster.slice(0, 2)}/${kh_poster.slice(2, 4)}/` +
				  			kh_poster

				  		db_mov['poster'] = kh_poster

			  			let kh_trailer = kh_mov.trailers[0].mobile_mp4.filename
			  			kh_trailer = 
			  				'https://kinohod.ru/o/' +
			  				`${kh_trailer.slice(0, 2)}/${kh_trailer.slice(2, 4)}/` +
			  				kh_trailer

			  			// db_mov['trailer'] = ['video', kh_trailer]
			  			if (!db_mov['trailer'] || db_mov['trailer'][0] === 'youtube') {
			  				db_mov['trailer'] = ['video', kh_trailer]
			  			}
			  		} catch (err) {
			  			Errors.add('На киноходе нет трейлера для фильма', db_mov.name)
			  		}

	  			}
	  		}

	  		if (!matched) {
	  			Errors.add('У кинохода нет информации по этому фильму', db_mov.name)
	  		}
	  	}
	}	
}


class dbUser {
	static async pushIntoDB(movies, cinemas) {
		const URI = 'mongodb+srv://update_script:update_pass@cluster0-uwr4g.mongodb.net/test?retryWrites=true'
		const client = await MongoClient.connect(URI, { useNewUrlParser: true })
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



(async function update() {
	const { cinemas, movies_href, movies_showcount } = await Parser.getCinemasData()
	console.log('Информация о кинотеатрах загружена')
	let movies = await Parser.getMoviesData(movies_href, movies_showcount)
	console.log('Информация по фильмам тоже')

	await Extra.modifySomeDataInto(movies)
	console.log('Небольшое вмешательство кинохода')
	await dbUser.pushIntoDB(movies, cinemas)
	console.log('База данных обновлена!')

})().catch(err => console.log(err))