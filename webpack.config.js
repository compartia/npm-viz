/* webpack.config.js */

const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const Clean = require('clean-webpack-plugin');
const path = require('path');
const setupServerMockup = require('./demo/serverMockup');

module.exports = {
    // Tell Webpack which file kicks off our app.
    entry: {
        index: path.resolve(__dirname, 'src/index.ts'),
    },
    // Tell Weback to output our bundle to ./dist/bundle.js
    output: {
        filename: '[name].js',
        path: path.resolve(__dirname, 'build')
    },
    // Tell Webpack which directories to look in to resolve import statements.
    // Normally Webpack will look in node_modules by default but since we’re overriding
    // the property we’ll need to tell it to look there in addition to the
    // bower_components folder.
    resolve: {
        modules: [
            path.resolve(__dirname,  'bower_components'),
            path.resolve(__dirname,  'node_modules'),

        ],
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.html']
    },
    // These rules tell Webpack how to process different module types.cd ..
    // Remember, *everything* is a module in Webpack. That includes
    // CSS, and (thanks to our loader) HTML.
    module: {
        rules: [
            {
                // If you see a file that ends in .html, send it to these loaders.
                test: /\.html$/,
                // This is an example of chained loaders in Webpack.
                // Chained loaders run last to first. So it will run
                // polymer-webpack-loader, and hand the output to
                // babel-loader. This let's us transpile JS in our `<script>` elements.
                use: [
                    { loader: 'babel-loader' },
                    { loader: 'polymer-webpack-loader' }
                ]
            },
            {
                // If you see a file that ends in .js, just send it to the babel-loader.
                test: /\.js$/,
                use: 'babel-loader'
            },
            {
                test: /\.ts$/,
                use: 'ts-loader',
            },
        ]
    },
    plugins: [
        // This plugin will generate an index.html file for us that can be used
        // by the Webpack dev server. We can give it a template file (written in EJS)
        // and it will handle injecting our bundle for us.
        new HtmlWebpackPlugin({
            inject: false,
            template: path.resolve(__dirname, 'src/index.ejs')
        }),
        // This plugin will copy files over to ‘./dist’ without transforming them.
        // That's important because the custom-elements-es5-adapter.js MUST
        // remain in ES2015. We’ll talk about this a bit later :)
        new CopyWebpackPlugin([{
            from: path.resolve(__dirname, 'bower_components/webcomponentsjs/*.js'),
            to: 'bower_components/webcomponentsjs/[name].[ext]'
        }]),

        new Clean(['build']),
    ],
    devServer: {
    contentBase: path.join(__dirname),
        compress: true,
        overlay: true,
        port: 9000,
        setup: setupServerMockup,
},
};
