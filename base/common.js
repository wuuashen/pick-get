import fs from 'fs'
import ora from 'ora'
import chalk from 'chalk'
import path from 'path'
import cookiefile from 'cookiefile'
import pino from 'pino'
import dayjs from 'dayjs'
import readline from 'readline'
import fetch from 'node-fetch'
import ProxyAgent from 'proxy-agent'
import ProgressBar from 'progress'
import pLimit from 'p-limit';
import * as dotenv from 'dotenv'
dotenv.config()

class common {

  constructor({ id, path, cookie, proxy, tryerr, update, timeout, limit } = {}) {
    this.options = { id, path, cookie, proxy, tryerr, update, timeout, limit }
    this.existCount = 0
    this.downloadCount = 0
    this.errorCount = 0
    this.resultList = []
    if(this.options.cookie) {
      let cookiemap = new cookiefile.CookieMap(this.options.cookie)
      this.cookie = cookiemap.toRequestHeader().replace ('Cookie: ','')
    }
  }

  request = (url, params) => {
    const proxyTable = () => {
      let proxy = this.options.proxy
      switch (true) {
        case typeof proxy === 'string':
          return proxy
          break;
        case proxy === true:
          return 'http://127.0.0.1:7890'
          break;
        default:
          return false
          break;
      }
    }
    return fetch(url, {
      agent: new ProxyAgent(proxyTable()),
      ...params
    })
    // .then(async response => {
    //   return response.json()
    // })
  }

  handerError = err => {
    let tips = `
拉取数据错误，可能因为以下原因：
1. 该用户不存在，请确认用户主页打开正常
2. 网络异常，请重试或者使用代理 --proxy
3. 该站点需要登录，请使用最新的cookie重试 --cookie
4. 站点更新了规则，请使用最新的版本
  `
    this.log(chalk.red(tips))
    // throw new Error(err)
  }

  async downloadFiles(resultList = [], existProcess = true, totalPages = false) {
    if(resultList.length === 0) {
      return this.log(`❌ 当前页可下载文件数量为 0`)
    }
    this.log(chalk.blue(`
当前目录是 ${this.picPath}
目前共下载 ${this.downloadCount} 个文件
开始下载第 ${this.currentPage}${totalPages ? ` / ${totalPages}` : ''} 页\n`
    ))
    
    let arr = [], count = 0, limit = pLimit(this.options.limit)
    for (const result of resultList) {
      if(count >= Number(this.options.count)) {
        break
      }
      // 支持多种不同类型的下载格式
      let urlFormat = [
        { url: result.picUrl, file: result.picFile },
        { url: result.videoUrl, file: result.videoFile },
        { url: result.url, file: result.file }
      ]
      urlFormat.forEach(item => {
        if(item['url']) {
          arr.push(
            limit(() => {
              return this.downloadFile(item, false)
              .catch(err => {
                // 处理文件已存在数量达到上限的情况
                if(err.status !== 'exist') return
                if(this.existCount < 100 && this.options.update) return
                if(this.existCount < 300) return
                if(!existProcess) return
                this.log(chalk.blue(`\n${this.options.id} 已存在的文件达到 ${this.existCount} 个，结束进程。`))
                return process.exit()
              })
            })
          )
          count ++
        }
      })
    }
    // 所有实例执行完成，无论成功或失败
    return Promise.allSettled(arr)
    .then(async d => {
      if(count >= Number(this.options.count)) {
        await this.endProcess()
      }
      this.log(chalk.green(`\n${arr.length} 个文件处理完成`));
    })
  }

  async downloadFile(result, printLog = true, progress = false) {

    const download = new Promise((async (resolve, reject) => {
      let { url, file } = result
      // 处理文件写入相关故障
      if(!url) {
        return reject({status: 'error', message: 'url无效', result})
      }
      let dir = path.parse(file).dir
      if(!fs.existsSync(dir)) {
        this.log(`创建目录 ${dir}\n`)
        fs.mkdirSync(dir, { recursive: true })
      }
      if(fs.existsSync(file)) {
        this.existCount ++ 
        return reject({status: 'exist', message: '文件已存在', result})
      }
      
      return this.request(url)
      .then(async response => {
        let contentLength = response.headers.get('content-length')
        // 显示下载进度
        if(progress) {
          let bar = new ProgressBar('downloading [:bar] :rate/bps :percent :etas', {
            complete: '=',
            incomplete: ' ',
            width: 20,
            total: parseInt(contentLength, 10)
          })
  
          response.body
          .on('data', chunk => {
            bar.tick(chunk.length)
          })
          .on('end', () => {})
        }
        return response.arrayBuffer()
      })
      .then(ab => {
        let data = Buffer.from(ab)
        fs.writeFile(file, data, err => {
          if(err) {
            throw new Error(err)
          }
          resolve({status: 'success', message: '下载成功', result})
        })
      })
      // 处理网络相关故障
      .catch(async err => {
        reject({status: 'error', result, message: `下载失败 ${err.message}`})
      })
    }))
    // 防止某些意外情况导致的超时
    const timeout = new Promise((resolve, reject) => {
      let tm = this.options.timeout
      if (tm) {
        setTimeout(() => reject({status: 'error', result, message: `下载失败 request timeout ${tm}`}), tm)
      }
    })

    return new Promise((resolve, reject) => {
      let { url, file } = result
      let spinner = printLog ? ora(`正在下载...\n${url}`).start() : {succeed: () => {}, fail: () => {}}
      Promise.race([download, timeout])
      .then(d => {
        resolve(d)
        let text = `${d.message}\n${file}`
        printLog ? spinner.succeed(text) : this.log(chalk.italic.green(text))
        this.downloadCount ++
        this.writeLog('success', result)
        this.resultList.push(result)
      })
      .catch(err => {
        reject(err)
        let text = `${err.message}\n${file}`
        if(err.status === 'exist') {
          printLog ? spinner.fail(text) : this.log(chalk.italic.gray(text))
        } else {
          printLog ? spinner.fail(text) : this.log(chalk.italic.red(text))
          this.writeLog('error', {
            ...result,
            name: 'downloadFile', 
            err: err.message
          })
        }
        this.errorCount ++
      })
    })
  }

  async readErrFile(download = false) {
    let file = path.join(this.picPath, 'error.log')
    if(!fs.existsSync(file)) {
      return []
    }

    let rl = readline.createInterface({
      input: fs.createReadStream(file),
      output: process.stdout,
      terminal: false
    })
    let arr = []
    
    return new Promise((resolve, reject) => {
      // 逐行读取文件
      rl.on('line', line => {
        try {
          arr.push(JSON.parse(line))
        } catch (err) {}
      })
  
      rl.on('close', async () => {
        if(download) {
          this.log(chalk.blue(`\n\n开始尝试下载 ${file} 中记录的曾经下载错误的图片`))
          await this.downloadFiles(arr, false)
          this.endProcess()
        }
        resolve(arr)
      })

      rl.on('error', err => reject(err))
    })
  }

  sleep(time, text) {
    return new Promise((resolve) => {
      const spinner = ora(`\n缓冲 ${(time / 1000).toFixed(1)} 秒... \n`).start()
      setTimeout(() => {
        spinner.stop()
        resolve();
      }, time);
    });
  }

  async writeLog (type, data, dir = this.picPath) {
    // console.log({type, data, dir})
    if(!dir) return

    // 排重
    let errFileList = await this.readErrFile()
    if(errFileList.find(item => item.url === data.url)) {
      return
    }
    const logger = pino({
      base: {},
      timestamp: () => `,"time":"${dayjs().format('YYYY/MM/DD HH:mm:ss.SSS')}"`
    },
    pino.destination({
      dest: `${dir}/${type}.log`,
      // 此处有坑！设置过大会导致Buffer值不够写文件的阈值，当此时进程被关闭，就没有来的及写还在Buffer的log 内容
      minLength: 0, // Buffer before writing
      sync: false
    }))
    type === 'success' && logger.info(data)
    type === 'error' && logger.error(data)
  }

  log(...values) {
    console.log(...values)
  }

  async endProcess() {
    this.log(`${this.picPath}`)
    await this.sleep(2000)
    this.log(chalk.blue(`\n\n=========== 下载统计 ===========`))
    console.table({
      '用户': this.options.id,
      '页数': this.currentPage,
      '文件数': this.downloadCount,
      '失败数': this.errorCount
    })
    process.exit()
    return Promise.resolve()
  }

  // 序列化文件大小
  formatBytes(bytes, decimals = 1) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

}

export default common
