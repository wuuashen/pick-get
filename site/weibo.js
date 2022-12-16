#!/usr/bin/env node
import path from 'path'
import url from 'url'
import chalk from 'chalk'
import ora from 'ora'
import querystring from 'querystring'
import common from '../base/common.js'
import fs from 'fs'
import { CLIENT_RENEG_LIMIT } from 'tls'

class weibo extends common {
  
  constructor(o) {
    super(o)
    this.options.video = o.video

    this.currentPage = 1
    this.picPath = ''
    this.uid = ''
    let uid_str = `uid=${this.options.id}`, 
        name_str = `screen_name=${this.options.id}`
    
    // 用户基本信息
    this.pageUrl = encodeURI(`https://weibo.com/ajax/profile/info?${isNaN(Number(this.options.id)) ? name_str : uid_str}`)
    // 用户相册
    this.baseUrl = ({uid, since_id}) => (`https://weibo.com/ajax/profile/getImageWall?uid=${uid}&sinceid=${since_id}${since_id ? '' : '&has_album=true'}`)
    // 用户视频
    this.baseVideoUrl = ({uid, cursor}) => (`https://weibo.com/ajax/profile/getWaterFallContent?uid=${uid}&cursor=${cursor}`)
    this.headers = {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
      "accept-language": "en,zh-CN;q=0.9,zh;q=0.8",
      "cache-control": "no-cache",
      "pragma": "no-cache",
      "sec-ch-ua": "\"Chromium\";v=\"106\", \"Google Chrome\";v=\"106\", \"Not;A=Brand\";v=\"99\"",
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": "\"macOS\"",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
      "sec-fetch-user": "?1",
      "upgrade-insecure-requests": "1",
      "cookie": "SUB=_2AkMUI6j8f8NxqwJRmP4QyWLqbIV0zArEieKif1knJRMxHRl-yT9jqmI5tRB6P6OGE37CDjAUzr6TupiK3-_qCx9d9kwK; SUBP=0033WrSXqPxfM72-Ws9jqgMF55529P9D9WhN44j0nL9Y16P1iNfLVLkn; XSRF-TOKEN=42Xl6dm9tN_vspZKokankTtD; WBPSESS=kErNolfXeoisUDB3d9TFHzDp85NDmaQxFepQvSonaEonngTSgE1F8ikTiKSMHoxEF0P6w6cbfk569n4qySlGkyJlyqwMWSE2WdUzfC2LK2v87BbbkZHFi2jiKeamJPCxXonmCFKLX6HwkeEgYUT8LKP11mhFTStAEYU1kWH8dxY="
    }
    if(this.cookie) {
      this.headers.cookie = this.cookie
    }
  }

  async init() {

    // 设置下载目录
    await this.getPageData()

    if(this.options.tryerr) {
      return await this.readErrFile(true)
    }

    const eachPayload = async data => {
      const next = data.video ? 'cursor' : 'since_id'
      if(!data[next] || data[next] === -1) {
        return await this.endProcess()
      }
      const payload = await this.getResultList({...data})
      await this.downloadFiles(payload.resultList)
      await this.sleep(5000 * Math.random())
      eachPayload({...payload.nextData, video: data.video})
      this.currentPage ++
    }

    const callDownPic = async (text, video) => {
      let params = video ? { cursor: 0, video } : { since_id: 0, video }
      this.log(chalk.green(text, this.picPath))
      // 获取第 1 页
      const data = await this.getResultList(params)
      // 下载第 1 页
      await this.downloadFiles(data.resultList)
      this.currentPage ++
      // 下载第 2 页及以后
      eachPayload({...data.nextData}, video)
    }

    this.options.video ? 
    callDownPic('开始下载视频到:', true) :
    callDownPic('开始下载图片到:', false)
  }

  async getResultList(nextData, tryCount = 0) {
    let baseUrl = nextData.video ? this.baseVideoUrl({...nextData, uid: this.uid}) : this.baseUrl({...nextData, uid: this.uid})
    tryCount ++
    try {
      this.log('\n')
      const spinner = ora(baseUrl).start()
      const response = await this.request(baseUrl, { headers: this.headers })
      const data = await response.json()

      spinner.stopAndPersist({symbol: '🟢'})
      if(data.data.list) {
        return Promise.resolve({
          baseUrl,
          resultList: this.eachEdges(data.data.list, nextData.video),
          nextData: nextData.video ? {cursor: data.data.next_cursor} : {since_id: data.data.since_id},
          video: nextData.video
        })
      }
    } catch (err) {
      // 如果错误重试3次
      if(tryCount <= 3) {
        this.log(chalk.red(`\n请求失败 ${err.message}\n正在重试第${tryCount}次`))
        return this.getResultList(nextData, tryCount).catch(e => {
          // throw new Error(e)
        })
      }
      spinner.stopAndPersist({symbol: '🔴'})
      this.writeLog('error', {
        name: 'getResultList',
        err,
        url: baseUrl
      })
      return Promise.reject(err)
    }
  }

  async getPageData() {
    try {
      const spinner = ora(this.pageUrl).start()
      this.log('\n')
      const response = await this.request(this.pageUrl, { headers: this.headers })
      const data = await response.json()
      spinner.stopAndPersist({symbol: '🚀'})
      // 设置下载目录
      this.picPath = path.join(this.options.path, `weibo/${data.data.user.id}@${data.data.user.screen_name}`)

      fs.mkdirSync(this.picPath, { recursive: true })
      fs.writeFileSync(path.join(this.picPath, 'index.log'), JSON.stringify(data, null, 2), {flags: 'w+'})

      if(data.ok !== 1) {
        throw new Error(JSON.stringify(data, null, 2))
      }

      this.uid = data.data.user.id
      return Promise.resolve({
        baseUrl: this.pageUrl
      })
    } catch (err) {
      // this.log(err)
      this.handerError(err)
      this.writeLog('error', {
        name: 'getPageData',
        err, 
        url: this.pageUrl
      })
      return Promise.reject(err)
    }
  }

  eachEdges (list, video) {
    const resultList = [];
    if(video) {
      for (const item of list) {
        const videoUrl = item.page_info.media_info.stream_url_hd
        resultList.push({
          id: item.id,
          videoUrl,
          videoFile: `${this.picPath}/video/${item.id}-${path.parse(videoUrl).base.replace(/\?.+/, '')}`
        })
      }
      return resultList
    }
    for (const item of list) {
      const p = `https://wx3.sinaimg.cn/large/${item.pid}.jpg`
      const v = item.video
      const { videoUrl, videoFile, ...params } = {
        id: item.pid,
        picUrl: p,
        picFile: `${this.picPath}/${path.parse(p).base}`,
        videoUrl: v,
        videoFile: v ? `${this.picPath}/${item.pid}-${path.parse(decodeURIComponent(item.video)).base.replace(/\?.+/, '')}` : null, 
      }

      item.type === 'livephoto' ?
      resultList.push({ ...params, videoUrl, videoFile }) : 
      resultList.push({ ...params })
    }
    return resultList
  } 
}

export default weibo