#!/usr/bin/env node
import path from 'path'
import chalk from 'chalk'
import ora from 'ora'
import common from '../base/common.js'
import fs from 'fs'
import fetch from 'node-fetch'

class instagram extends common {
  
  constructor(o) {
    super(o)
    this.currentPage = 1
    this.maxPage = Number(o.page)
    this.picPath = path.join(this.options.path, `instagram/${this.options.id}`)
    // 用户基本信息+第一页相册数据
    this.pageUrl = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${this.options.id}`
    // 用户相册第二页及以后
    this.baseUrl = variables => {
      const query_hash = '003056d32c2554def87228bc3fd9668a'
      return encodeURI(`https://www.instagram.com/graphql/query/?query_hash=${query_hash}&variables=${JSON.stringify(variables)}`)
    }
    this.headers = {
      "user-agent": "Instagram 219.0.0.12.117 Android",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
      "accept-language": "en,zh-CN;q=0.9,zh;q=0.8",
      "cache-control": "max-age=0",
      "sec-ch-ua": "\"\"",
      "sec-ch-ua-mobile": "?1",
      "sec-ch-ua-platform": "\"\"",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
      "sec-fetch-user": "?1",
      "upgrade-insecure-requests": "1",
    }
    if(this.cookie) {
      this.headers.cookie = this.cookie
    }
  }

  async init() {

    if(this.options.tryerr) {
      return await this.readErrFile(true)
    }
    
    const eachPayload = async nextData => {
      if((this.maxPage && this.currentPage >= this.maxPage) || !nextData.page_info.has_next_page) {
        this.endProcess()
      }
      this.currentPage += 1
      const payload = await this.getResultList({
        ...nextData, 
        id: data.nextData.id, 
        username: data.nextData.username
      })
      // this.log(payload, 'payload')
      await this.downloadFiles(payload.resultList, Math.ceil(data.nextData.count / 12))      
      await this.sleep(5000 * Math.random())
      eachPayload(payload.nextData)
    }
    // 获取第 1 页
    const data = await this.getPageData()
    // 下载第 1 页
    await this.downloadFiles(data.resultList, Math.ceil(data.nextData.count / 12))
    // 下载第 2 页及以后
    eachPayload(data.nextData)

  }

  async getResultList(nextData, tryCount = 0) {
    const baseUrl = typeof nextData === 'object' ? this.baseUrl({
      id: nextData.id,
      first: 12,
      after: nextData.page_info.end_cursor
    }) : nextData
    const spinner = ora(baseUrl).start()
    tryCount ++

    try {
      this.log('\n')
      const response = await this.request(baseUrl, { headers: this.headers })
      const data = await response.json()

      fs.writeFileSync(path.join(this.picPath, 'index.log'), JSON.stringify(data, null, 2), {flags: 'w+'})
      if(data.status !== 'ok') {
        throw new Error(JSON.stringify(data, null, 2))
      }

      const { edges, page_info } = data.data.user.edge_owner_to_timeline_media
      spinner.stopAndPersist({symbol: '🟢'})
      return Promise.resolve({
        baseUrl,
        resultList: this.eachEdges(edges),
        nextData: {
          page_info
        }
      })
    } catch (err) {
      // 如果错误重试3次
      if(tryCount <= 3) {
        this.log(chalk.red(`\n请求失败 ${err.message}\n正在重试第${tryCount}次`))
        await this.sleep(2500)
        return this.getResultList(nextData, tryCount).catch(e => {
          throw new Error(e)
        })
      }
      spinner.stopAndPersist({symbol: '🔴'})
      this.handerError(err)
      this.writeLog('error', {
        name: 'getResultList',
        err,
        url: baseUrl
      })
      this.getResultList(nextData)
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

      fs.mkdirSync(this.picPath, { recursive: true })
      fs.writeFileSync(path.join(this.picPath, 'index.log'), JSON.stringify(data, null, 2), {flags: 'w+'})

      if(data.status !== 'ok') {
        throw new Error(JSON.stringify(data, null, 2))
      }

      const graphql = data.data
      const { id, username } = graphql.user
      const { edges, page_info, count } = graphql.user.edge_owner_to_timeline_media
      return Promise.resolve({
        baseUrl: this.pageUrl,
        resultList: this.eachEdges(edges),
        nextData: {
          id, page_info, count, username
        }
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

  eachEdges(edges) {
    const resultList = [];
    const pushList = (item, id) => {
      // const id = item.node.id
      const p = item.node.display_url
      const v = item.node.video_url
      const { videoUrl, videoFile, ...params } = {
        id, 
        picUrl: p, 
        // picPath: this.picPath,
        picFile: `${this.picPath}/${id}-${path.parse(p).base.replace(/\?.+/, '')}`,
        videoUrl: v,
        videoFile: v ? `${this.picPath}/${id}-${path.parse(v).base.replace(/\?.+/, '')}` : null, 
      }
      item.node.is_video ? 
      resultList.push({ ...params, videoUrl, videoFile }) : 
      resultList.push({ ...params })
    }
    for (const edge of edges) {
      if(edge.node.edge_sidecar_to_children) {
        for (const item of edge.node.edge_sidecar_to_children.edges) {
          pushList(item, edge.node.shortcode)
        }
      } else {
        pushList(edge, edge.node.shortcode)
      }
    }
    return resultList
  }

}

export default instagram