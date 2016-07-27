module.exports = {
  entry: ['./dashboard/static/test.js'],
  output: {
    publicPath: "http://localhost:9876/",
    path: './dashboard/build',
    filename: 'bundle.js'
  },
  module: {
    loaders: [
      { test: /\.css$/, loader: 'style-loader!css-loader' },
      { test: /\.woff(2)?(\?v=[0-9]\.[0-9]\.[0-9])?$/, loader: "url-loader?limit=10000&minetype=application/font-woff" },
      { test: /\.(ttf|eot|svg)(\?v=[0-9]\.[0-9]\.[0-9])?$/, loader: "file-loader" },
      { test: /\.(png|eot|svg|ttf|woff|woff2)$/, loader: 'file-loader?limit=1000000' }
    ]
  }
};