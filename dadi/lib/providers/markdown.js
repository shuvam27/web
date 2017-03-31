'use strict'

const _ = require('underscore')
const fs = require('fs')
const path = require('path')
const async = require('async')
const yaml = require('js-yaml')
const marked = require('marked')
const meta = require('@dadi/metadata')

const MarkdownProvider = function () {}

/**
 * initialise - initialises the datasource provider
 *
 * @param  {obj} datasource - the datasource to which this provider belongs
 * @param  {obj} schema - the schema that this provider works with
 * @return {void}
 */
MarkdownProvider.prototype.initialise = function initialise (datasource, schema) {
  this.datasource = datasource
  this.schema = schema
  this.extension = schema.datasource.source.extension ? schema.datasource.source.extension : 'md'
}

/**
 * processSortParameter
 *
 * @param  {?} obj - sort parameter
 * @return {?}
 */
MarkdownProvider.prototype.processSortParameter = function processSortParameter (obj) {
  let sort = {}

  if (_.isObject(obj)) {
    _.each(obj, (sortInteger, field) => {
      if (sortInteger === -1 || sortInteger === 1) {
        sort[field] = sortInteger
      }
    })
  }

  return sort
}

/**
 * load - loads data form the datasource
 *
 * @param  {string} requestUrl - url of the web request (not used)
 * @param  {fn} done - callback on error or completion
 * @return {void}
 */
MarkdownProvider.prototype.load = function load (requestUrl, done) {
  try {
    const sourcePath = path.normalize(this.schema.datasource.source.path)

    // Only get files that match the extension provided, or the default set above
    const extFilter = new RegExp('.' + this.extension + '$', 'g')
    const filenames = fs.readdirSync(sourcePath).filter(i => extFilter.test(i))
    const filepaths = filenames.map(i => path.join(sourcePath, i))

    // Process each file
    async.map(filepaths, this.readFileAsync, (err, readResults) => {
      if (err) return done(err, null)

      this.parseRawDataAsync(readResults, (posts) => {
        const sort = this.processSortParameter(this.schema.datasource.sort)
        const search = this.schema.datasource.search
        const count = this.schema.datasource.count
        const fields = this.schema.datasource.fields || []
        const filter = this.schema.datasource.filter
        const page = this.schema.datasource.page || 1

        let metadata = []

        if (search) {
          posts = _.where(posts, search)
        }

        if (filter) {
          posts = _.filter(posts, (post) => {
            return _.where([post.attributes], filter).length > 0
          })
        }

        let postCount = posts.length

        // Sort posts by attributes field (with date support)
        if (sort && Object.keys(sort).length > 0) {
          Object.keys(sort).forEach(field => {
            posts = _.sortBy(posts, (post) => {
              const value = post.attributes[field]
              const valueAsDate = new Date(value)
              return (valueAsDate.toString() !== 'Invalid Date')
                ? +(valueAsDate)
                : value
            })
            if (sort[field] === -1) {
              posts = posts.reverse()
            }
          })
        }

        // Paginate if required
        if (page && count) {
          const offset = (page - 1) * count
          posts = posts.slice(offset, offset + count)

          // Metadata for pagination
          const options = []
          options['page'] = parseInt(page)
          options['limit'] = parseInt(count)

          metadata = meta(options, parseInt(postCount))
        }

        if (fields && !_.isEmpty(fields)) {
          posts = _.chain(posts).selectFields(fields.join(',')).value()
        }

        done(null, { results: posts, metadata: metadata || null })
      })
    })
  } catch (ex) {
    done(ex, null)
  }
}

MarkdownProvider.prototype.readFileAsync = function readFileAsync (filename, callback) {
  fs.readFile(filename, 'utf8', function(err, data){
    return callback(err, {_name: filename, _contents: data})
  })
}

MarkdownProvider.prototype.parseRawDataAsync = function parseRawDataAsync (data, callback) {
  const yamlRegex = /---[\n\r]+([\s\S]*)[\n\r]+---[\n\r]+([\s\S]*)/
  const posts = []

  for (let i = 0; i < data.length; i++) {
    const bits = yamlRegex.exec(data[i]._contents)
    const attributes = yaml.safeLoad(bits[1] || '')
    const contentText = bits[2] || ''
    const contentHtml = marked(contentText)
    const parsedPath = path.parse(data[i]._name)

    // Some info about the file
    const meta = {
      location: data[i]._name,
      extension: parsedPath.ext,
      handle: parsedPath.name
    }

    posts.push({
      meta,
      attributes,
      original: data[i]._contents,
      contentText,
      contentHtml
    })
  }

  callback(posts)
}

module.exports = MarkdownProvider
