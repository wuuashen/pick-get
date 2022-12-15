#!/usr/bin/env node
import { program } from 'commander'
import chalk from 'chalk'
import weibo from '../site/weibo.js'
import instagram from '../site/instagram.js'

program
  .command('weibo <user-id>')
  .description('抓取微博用户媒体文件')
  .addHelpText('after', `
Example: 
  pick-get weibo 5769900702
  `)
  .option('-v, --video', '只下载视频文件')
  .action((id, options) => {
    try {
      new weibo({ ...program.opts(), ...options, id}).init()
    } catch (error) {
      console.log(chalk.red(error.message))
      program.help()
    }
  })

program
  .command('instagram <user-id>')
  .description('抓取instagram用户媒体文件')
  .addHelpText('after', `
Example: 
  pick-get instagram lets_kate__
  `)
  .action((id, options) => {
    try {
      new instagram({ ...program.opts(), ...options, id}).init()
    } catch (error) {
      console.log(chalk.red(error.message))
      program.help()
    }
  })


  program
    .name('pick-get')
    .usage("<command> [options] <user-id>")
    .description('批量抓取社交网站用户的媒体文件的CLI爬虫工具, 目前支持weibo和instagram')
    .option('-p, --path [char]', '文件下载目录', process.cwd())
    .option('-c, --cookie [char]', '使用cookie文件请求数据，只支持 Netscape格式 https://curl.se/rfc/cookie_spec.html')
    .option('-x, --proxy [url]', '使用代理服务器，格式：${protocol}${hostname}${port}')
    .option('-t, --tryerr', '下载日志中记录的下载失败的文件')
    // .option('--update [char]', '批量更新指定目录下的所有用户数据')
    .option('--timeout [number]', '设置下载文件超时时间，如果经常提示超时可以设置大一些', 30000)
    .option('--count [number]', '限制文件下载数量，否则将所有文件下载完成')
    .option('--limit [number]', '限制文件下载并发数', 3)
    .version('1.0.1')


program.showHelpAfterError()
program.addHelpText('before', 'Version 1.0.1\n')
program.parse()
