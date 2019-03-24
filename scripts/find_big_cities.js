const axios = require('axios');
const cheerio = require('cheerio');


(async function sort_cities() {
    const {data: towns_html} = await axios.get('https://spb.kinoafisha.info/service/header/')
    let $ = cheerio.load(towns_html)
    const cities_href = $('.chooseCity_list')
        .find('.chooseCity_listLink')
        .map((i, elem) => $(elem).attr('href'))
        .get()

    let raiting = []
    // let i = 0
    for (let href of cities_href) {
        // i++
        // if (i > 50) break
        const city = href.match(/https:\/\/(.+)\.kinoafisha/)[1]
        const cinemas_href = href.slice(0, -11) + 'cinema/#'

        const {data: cinemas_page} = await axios.get(cinemas_href)
        $ = cheerio.load(cinemas_page)

        const theaters_number = $('.aboutFav_columns').children().length
        raiting.push([city, theaters_number])
    }

    raiting.sort((a, b) => b[1] - a[1])
    console.log(raiting)
})()