module.exports = {
    publicPath: '/stat/d/',
    configureWebpack: config => {
        if (process.env.NODE_ENV === 'production') {
            // mutate config for production...
        } else {
            // mutate for development...
            // process.env.HOST = '00'
        }
    }
}