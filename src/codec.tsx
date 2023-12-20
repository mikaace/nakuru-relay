"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

import {DiscordBot} from "@koishijs/plugin-adapter-discord";
import {KookBot, Type} from "@koishijs/plugin-adapter-kook";
import {QQBot} from "@koishijs/plugin-adapter-qq";
import {h, Quester} from "@satorijs/satori";
import {Config, destination, domain, region, webhooks} from "./index";
import {Context, segment} from "koishi";
import FormData from "form-data";
import axios from 'axios';
import internal, {Readable} from "stream";
import {createHash} from "crypto";
import * as socksProxy from 'socks-proxy-agent'

export const inject = ["database"];

interface webhookMsg {
  id:string,
  type:string,
  content:string,
  channel_id:string,
  author:{},
  attachments: [],
  embeds: [],
  mentions: [],
  mention_roles: [],
  pinned:boolean,
  mention_everyone:boolean,
  tts: false,
  timestamp:string
  edited_timestamp: null,
  flags:number,
  components:[],
  application_id:string,
  webhook_id:string
}

//todo：discord embed卡片支持
/*
future: 1)通过markdown代码块实现dc彩色文字
        2)qq频道及qq群支持优化(前提是主动消息数量限制放宽)
*/

export async function relay(session,ctx:Context,config:Config,{domain,destination}: {domain?: domain,destination?: destination},Update:string,webhooks?:webhooks){
  let update = Update;

  const kook = ctx.bots.find(
    (bt) => bt.platform === "kook"
  ) as unknown as KookBot;

  const discord = ctx.bots.find(
    (bt) => bt.platform === "discord"
  ) as unknown as DiscordBot;

  const qqguild = ctx.bots.find(
    (bt) => bt.platform === "qqguild"
  ) as unknown as QQBot;

  async function transformUrl({ type, attrs }: h) {
    if (await kook.http.isPrivate(attrs.url)) {
      const payload = new FormData();
      const result = await kook.ctx.http.file(attrs.url, attrs);
      payload.append('file', Buffer.from(result.data), {
        filename: attrs.file || result.filename,
      });
      const { url } = await kook.request('POST', '/asset/create', payload, payload.getHeaders())
      return url
    } else if (!attrs.url.includes('kookapp.cn')) {
      const res = await kook.ctx.http.get<internal.Readable>(attrs.url, {
        headers: { accept: type + '/*' },
        responseType: 'stream',
        timeout: +attrs.timeout || undefined,
      });
      const payload = new FormData();
      payload.append('file', res, {
        filename: 'file',
      })
      const { url } = await kook.request('POST', '/asset/create', payload, payload.getHeaders());
      return url;
    } else {
      return attrs.url;
    }
  }

  async function getRaw(session){
    let raw = [];
    session.platform === ("qqguild"||"discord")
      ? raw.push(processQQGuild(session.elements))
      : (session.platform === "kook")&&(session?.event?._data?.type === 10)
        ? raw.push(...[0,session.event._data.content])
        : raw.push(processKookContent(session.elements));

    return raw;
  }
  function extension(str) {
    let index = str.lastIndexOf('.');
    if (index === -1 || index === str.length - 1) {
      return '';
    } else {
      return str.slice(index + 1);
    }
  }
  function $concat(str1, str2) {
    if (str1.endsWith(str2)) {
      return str1;
    } else {
      return str1 + str2;
    }
  }
  function processKookContent(raw){
    return raw.map((element) => {
      if (element.type !== 'text') return element;
      else {
        let matchURL1 = /\[(\b((?:[a-z][\w-]+:(?:\/{1,3}|[a-z0-9%])|www\d{0,3}[.]|[a-z0-9.\-]+[.][a-z]{2,4}\/)(?:[^\s()<>]+|\(([^\s()<>]+|(\([^\s()<>]+\)))*\))+(?:\(([^\s()<>]+|(\([^\s()<>]+\)))*\)|[^\s`!()\[\]{};:'".,<>?«»“”‘’])))]/g;
        let matchURL2 = /\((\b((?:[a-z][\w-]+:(?:\/{1,3}|[a-z0-9%])|www\d{0,3}[.]|[a-z0-9.\-]+[.][a-z]{2,4}\/)(?:[^\s()<>]+|\(([^\s()<>]+|(\([^\s()<>]+\)))*\))+(?:\(([^\s()<>]+|(\([^\s()<>]+\)))*\)|[^\s`!()\[\]{};:'".,<>?«»“”‘’])))\)/g;
        element.attrs.content = element.attrs.content
          .replace(matchURL2,'')
          .replace(matchURL1,(match) => {
            return match.replace(/^(\[)|]$/g,'')
          })
        return element;
      }
    });
  }
  function processCard(r){
    //@ts-ignore
    let msg:segment = <message />
    function add(element){
      msg.children.push(element)
    }
    let cards = JSON.parse(r)
    cards.map(card => {
      card.modules.map(module => {
        msg.children.push(
          //@ts-ignore
          <author nickname = {session.author.username} avatar = {session.author.avatar}/>
        );
        if (module.type === 'section') {
          if (module.text?.content) {
            //@ts-ignore
            add(<text content={`${module.text.content}\n`}></text>);
          }
          if (module.text.type === 'paragraph'){
            function transpose(matrix) {
              return matrix[0].map((_, i) => matrix.map(row => row[i]));
            }
            function alignColumns(content) {
              const maxLengths = content[0].map((_, i) => Math.max(...content.map(row => row[i].length)));
              return content.map(row => row.map((cell, i) => cell.padEnd(maxLengths[i])).join(' '));
            }
            let content_ = []
            for (let i=0;i<module.text.cols;i++){
              content_[i] = module.text.fields[i].content.split('\n');
            }
            let content:string;
            content = alignColumns(transpose(content_)).join('\n');
            //@ts-ignore
            add(<text content={`${content}\n`}></text>);
          }
          if (module?.accessory?.type === 'image') {
            //@ts-ignore
            add(<image url={module.accessory.src}/>);
          }
          if (module?.accessory?.type === 'button') {
            let theme = '';
            if (module.accessory.theme === 'warning') theme = 'danger';
            if (module.accessory?.click === 'link') {
              //@ts-ignore
              add(<button class={theme} type={module.accessory.click} href={module.accessory.value}>
                {module.accessory.text.content}
              </button>);
            }else if (module.accessory?.click === 'return-val') {
              add(<button class={theme} id={module.accessory?.value}>
                {module.accessory.text.content}
              </button>);
            }else{
              add(<button class={theme}>
                {module.accessory.text.content}
              </button>);
            }
          }
        }
        if ((module.type !== 'file')&&(module.type === 'image-group'||'container')) {
          module.elements.map(element => {
            //@ts-ignore
            add(<image url={element.src}/>);
          });
        }
        if (module.type === 'action-group') {
          module.elements.map(element => {
            let theme = '';
            if (element.theme === 'warning') theme = 'danger';
            if (element?.click === 'link') {
              //@ts-ignore
              add(<button class={theme} type={element.click} href={element.value}>
                {element.text.content}
              </button>);
            }else if (element?.click === 'return-val') {
              add(<button class={theme} id={element?.value}>
                {element.text.content}
              </button>);
            }else{
              add(<button class={theme}>
                {element.text.content}
              </button>);
            }
          });
        }
        if (module.type === 'header') {
          //@ts-ignore
          add(<text content={`${module.text.content}\n`}></text>);
        }
        if (module.type === 'context') {
          module.elements.map(element => {
            if (element.type === 'plain-text'||'kmarkdown') {
              //@ts-ignore
              add(<text content={`${element.content}\n`}></text>);
            }
          })
        }
        if (module.type === 'file') {
          let src = createHash('sha256').update(module.title).digest('hex').slice(0,8);
          //@ts-ignore
          add(<file url={module.src} file={$concat(src,`.${extension(module.src)}`)}/>);
        }
        if (module.type === 'audio') {
          let src = createHash('sha256').update(module.title).digest('hex').slice(0,8);
          //@ts-ignore
          add(<audio url={module.src} file={$concat(src,`.${extension(module.src)}`)}/>);
        }
        if (module.type === 'video') {
          let src = createHash('sha256').update(module.title).digest('hex').slice(0,8);
          //@ts-ignore
          add(<video url={module.src} file={$concat(src,`.${extension(module.src)}`)}/>);
        }
      });
    });
    return msg;
  }
  function processQQGuild(r){
    if (session.platform === 'discord') return r;
    let mentions = session.event._data.d.mentions;
    r = r.map(element => {
      if (element.type !== 'at') return element;
      mentions.map((user) => {
        if (user.id === element.attrs.id) {
          element.attrs.name = user.username;
        }
      })
      return element;
    });
    return r;
  }
  function unixToBeijing(unixTimestamp) {
    const date = new Date(unixTimestamp);
    const utc8Offset = 8 * 60 * 60 * 1000; // 8 hours in milliseconds
    const dateInBeijing = new Date(date.getTime() + utc8Offset);
    const hours = dateInBeijing.getUTCHours().toString();
    const minutes = dateInBeijing.getUTCMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }
  async function sendDiscord(raw_,config:Config,{domain,regionPart}: {domain?: domain,regionPart?: string},update:string):Promise<webhookMsg>{
    const httpsAgent = new socksProxy.SocksProxyAgent(config.proxy)
    let form = new FormData()
    let raw = raw_;
    let ChannelId:string;
    if (!domain||domain&&(domain.discordChannelId == ''||undefined)) {
      if (!regionPart||regionPart&&(regionPart == ''||undefined)) {
        return;
      } else {
        ChannelId = regionPart;
        let msg = {
          content:'',
          attachments:[],
          components:[]
        };
        let n = 0;
        await segment.transformAsync(raw, {
          async at(attrs) {
            if (attrs.id === discord.selfId) {
              return "";
            }
            let name = "";
            name = attrs.name;
            msg.content += `@${name} `;
          },
          text(attrs){
            let author:string;
            if (session.event._data.d?.referenced_message) {
              author = session.event._data.d.referenced_message.author.username;
              let msg_ = session.event._data.d.referenced_message.content;
              if (msg_.length > 15) {
                msg_ = `${msg_.slice(0, 15)}……`
              }
              if (session.event._data.d.referenced_message?.attachments) {
                session.event._data.d.referenced_message.attachments.map((attachment) => {
                  msg_ += attachment.filename;
                })
              }
              msg.content += `\u21B1\`${author}:${msg_}\`\n${attrs.content}`;
            }else{
              msg.content += attrs.content;
            }
            return '';
          },
          async image(attrs) {
            const {data} = await axios.get<Readable>(attrs.url, {
              responseType: "stream",httpsAgent
            });
            form.append(`files[${n}]`, data,{filename:attrs.file,contentType:extension(attrs.url)});
            n++
            return '';
          },
          async file(attrs) {
            const {data} = await axios.get<Readable>(attrs.url, {
              responseType: "stream",httpsAgent
            });
            form.append(`files[${n}]`, data,{filename:attrs.file,contentType:extension(attrs.url)});
            n++
            return '';
          },
          async record(attrs) {
            const {data} = await axios.get<Readable>(attrs.url, {
              responseType: "stream",httpsAgent
            });
            form.append(`files[${n}]`, data,{filename:attrs.file,contentType:extension(attrs.url)});
            n++
            return '';
          },
          async video(attrs) {
            const {data} = await axios.get<Readable>(attrs.url, {
              responseType: "stream",httpsAgent
            });
            form.append(`files[${n}]`, data,{filename:attrs.file,contentType:extension(attrs.url)});
            n++
            return '';
          },
          async face(attrs){
            msg.content += `<${attrs.animated ? "a" : ""}:${attrs.name}:${attrs.id}>`
            return '';
          }
        });
        let webhook = webhooks.find( webhook => webhook.channel_id === ChannelId);
        let payload = {
          content: msg.content,
          username: session.username,
          avatar_url: session.author.avatar
        };
        form.append('payload_json',JSON.stringify(payload));
        try{
          if (update) {
            return await discord.http.patch(`${webhook.url}/messages/${update}`, form);
          }else {
            return await discord.http.post(`${webhook.url}?wait=true`, form);
          }
        }catch (error) {
          if (!Quester.isAxiosError(error) || !error.response) throw error;
          throw new Error(`[${error.response.status}] ${JSON.stringify(error.response.data,null,2)}`);
        }
      }
    } else {
      ChannelId = domain.discordChannelId;
    }
    let msg = {
      content:'',
      attachments:[],
      components:[]
    }
    let n = 0;
    await segment.transformAsync(raw, {
      async at(attrs) {
        if (attrs.id === discord.selfId) {
          return "";
        }
        let name = "";
        name = attrs.name;
        msg.content += `@${name} `;
      },
      text(attrs){
        if ((session.platform === 'kook')&&session.event.message?.quote?.content){
          let author = session.event.message.quote.user.name;
          let msg_:string;
          if (session.event.message.quote?.content) {
            msg_ = session.event.message.quote.content;
            if (msg_.length>15) {
              msg_ = `${msg_.slice(0, 15)}……`
            }
          }
          let type_:string;
          try{
            session.event.message.quote.elements.find((element) => {
              if (element?.type !== ('text' || 'at')) {
                type_ = element.type;
              }
            })
          }catch (e) {}
          if (type_) msg_ = `[${type_}]`;
          msg.content += `\u21B1\`${author}:${msg_}\`\n${attrs.content}`
        }else{
          msg.content += attrs.content;
        }
        return '';
      },
      async image(attrs) {
        const {data} = await axios.get<Readable>(attrs.url, {
          responseType: "stream",httpsAgent
        });
        form.append(`files[${n}]`, data,{filename:attrs.file,contentType:extension(attrs.url)});
        n++
        return '';
      },
      async file(attrs) {
        const {data} = await axios.get<Readable>(attrs.url, {
          responseType: "stream",
        });
        form.append(`files[${n}]`, data,{filename:attrs.file,contentType:extension(attrs.url)});
        n++
        return '';
      },
      async audio(attrs) {
        const {data} = await axios.get<Readable>(attrs.url, {
          responseType: "stream",
        });
        form.append(`files[${n}]`, data,{filename:attrs.file,contentType:extension(attrs.url)});
        n++
        return '';
      },
      async video(attrs) {
        const {data} = await axios.get<Readable>(attrs.url, {
          responseType: "stream",
        });
        form.append(`files[${n}]`, data,{filename:attrs.file,contentType:extension(attrs.url)});
        n++
        return '';
      }
    });
    let webhook = webhooks.find( webhook => webhook.channel_id === ChannelId);
    let payload = {
      content: msg.content,
      username: session.username,
      avatar_url: session.author.avatar,
    }
    form.append('payload_json',JSON.stringify(payload));
    try{
      if (update) {
        return await discord.http.patch(`${webhook.url}/messages/${update}`, form);
      }else {
        return await discord.http.post(`${webhook.url}?wait=true`, form);
      }
    }catch (error) {
      if (!Quester.isAxiosError(error) || !error.response) throw error;
      throw new Error(`[${error.response.status}] ${JSON.stringify(error.response.data)}`);
    }
  }
  async function sendKook(raw_,config:Config,{domain,regionPart}: {domain?: domain,regionPart?: string},update:string) {
    let source = [{
      type: "card",
      theme: "info",
      size: "lg",
      modules: [
        {
          type: "context",
          elements: [
            {
              type: "image",
              //@ts-ignore
              src: `${await transformUrl(<file url={session.author.avatar}></file>)} `
            },
            {
              type: "kmarkdown",
              content: `**(font)${session.author.name}(font)[white]** 今天 ${unixToBeijing(session.event.timestamp)}`
            }
          ]
        }
      ]
    }];
    let raw = raw_;
    let ChannelId:string;
    if (!domain||domain&&(domain.kookChannelId === ''||undefined)) {
      if (!regionPart||regionPart&&(regionPart == ''||undefined)) {
        return '';
      } else {
        ChannelId = regionPart;
        await Promise.all(raw.map(element => {
          if (element.type === 'at') {
            source[0].modules.push({
              type: "section",
              //@ts-ignore
              text: {
                type: "kmarkdown",
                content: `**(font)@${element.attrs.name}(font)[warning]**`
              }
            });
          }
          if (element.type === 'text') {
            let contents:string = element.attrs.content;
            if ((session.platform === 'kook')&&session.event.message?.quote){
              let author = session.event.message.quote.user.name;
              let msg_:string;
              if (session.event.message.quote?.content) {
                msg_ = session.event.message.quote.content;
                if (msg_.length>15) {
                  msg_ = `${msg_.slice(0, 15)}……`
                }
              }
              let type_:string
              try{
                session.event.message.quote.elements.find((element) => {
                  if (element?.type !== 'text' || 'at') {
                    type_ = element.type;
                  }
                })
              }catch (e) {}
              if (type_) msg_ = `[${type_}]`;
              contents = `\`${author}:${msg_}\`\n${element.attrs.content}`
            }
            source[0].modules.push({
              type: "section",
              //@ts-ignore
              text: {
                type: "kmarkdown",
                content: `${contents}`
              }
            });
          }
          if (element.type === 'image') {
            source[0].modules.push({
              type: "container",
              elements: [
                {
                  type: "image",
                  src: `${element.attrs.url}`
                }
              ]
            });
          }
        }));
        if (update) {
          return await kook.internal.updateMessage({msg_id:update,content:JSON.stringify(source)})
        }
        return await kook.internal.createMessage({
          type:Type.card,
          target_id:ChannelId,
          content:JSON.stringify(source)
        });
      }
    } else {
      ChannelId = domain.kookChannelId;
    }
    await Promise.all(raw.map(async element => {
      if (element.type === 'at') {
        source[0].modules.push({
          type: "section",
          //@ts-ignore
          text: {
            type: "kmarkdown",
            content: `**(font)@${element.attrs.name}(font)[warning]**`
          }
        });
      }
      if (element.type === 'text') {
        let contents:string = element.attrs.content;
        if (contents === " ") contents = '';
        if (session.event._data.d?.referenced_message) {
          let author = session.event._data.d.referenced_message.author.username;
          let msg_ = session.event._data.d.referenced_message.content;
          if (msg_.length > 15) {
            msg_ = `${msg_.slice(0, 15)}……`
          }
          if (session.event._data.d.referenced_message?.attachments) {
            session.event._data.d.referenced_message.attachments.map((attachment) => {
              msg_ += attachment.filename;
            })
          }
          contents = `\`${author}:${msg_}\`\n${element.attrs.content}`;
        }
        if ((session.platform === 'kook')&&session.event.message?.quote){
          let author = session.event.message.quote.user.name;
          let msg_:string;
          if (session.event.message.quote?.content) {
            msg_ = session.event.message.quote.content;
            if (msg_.length>15) {
              msg_ = `${msg_.slice(0, 15)}……`
            }
          }
          let type_:string;
          try{
            session.event.message.quote.elements.find((element) => {
              if (element?.type !== ('text' || 'at')) {
                type_ = element.type;
              }
            })
          }catch (e) {}
          if (type_) msg_ = `[${type_}]`;
          contents = `\`${author}:${msg_}\`\n${element.attrs.content}`
        }
        source[0].modules.push({
          type: "section",
          //@ts-ignore
          text: {
            type: "kmarkdown",
            content: `${contents}`
          }
        });
      }
      if (element.type === 'image') {
        //@ts-ignore
        let img_url = await transformUrl(<image url={element.attrs.url}></image>);
        source[0].modules.push({
          type: "container",
          elements: [
            {
              type: "image",
              src: img_url
            }
          ]
        });
      }
      if (element.type === 'file') {
        //@ts-ignore
        let file_url = await transformUrl(<file url={element.attrs.url}></file>);
        source[0].modules.push(
          {
            type: "file",
            //@ts-ignore
            title: element.attrs.file,
            src: file_url
          }
        );
      }
      if (element.type === 'record') {
        //@ts-ignore
        let audio_url = await transformUrl(<file url = {element.attrs.url}/>)
        source[0].modules.push(
          {
            type: "audio",
            //@ts-ignore
            title: element.attrs.file,
            src: audio_url,
            cover: "https://img.kookapp.cn/attachments/2023-12/07/IIhMrZISUd00w00w.jpg"//Aitsuki Nakuru desu⭐
          }
        );
      }
      if (element.type === 'video') {
        //@ts-ignore
        let video_url = await transformUrl(<file url = {element.attrs.url}/>)
        source[0].modules.push(
          {
            type: "video",
            //@ts-ignore
            title: element.attrs.file,
            src: video_url
          }
        );
      }
      if (element.type === 'face') {
        //@ts-ignore
        let face_url = await transformUrl(<file url = {element.children[0].attrs.url}/>);
        source[0].modules.push(
          {
            type: "context",
            elements: [
              {
                type: "image",
                //@ts-ignore
                src: face_url
              },
              {
                type: "kmarkdown",
                content: ''
              }
            ]
          }
        );
      }
    }));
    if (update) {
      return await kook.internal.updateMessage({msg_id:update,content:JSON.stringify(source)})
    }
    return await kook.internal.createMessage({
      type:Type.card,
      target_id:ChannelId,
      content:JSON.stringify(source)
    });
  }
  async function sendQQGuild(raw_,config:Config,{domain,regionPart}: {domain?: domain,regionPart?: string},update:string){
    let raw = raw_;
    let ChannelId:string;
    if (!domain||(domain&&(!domain.qqChannelId||domain.qqChannelId === ''))) {
      if (!regionPart||regionPart&&(regionPart === ''||undefined)) {
        return ''
      } else {
        ChannelId = regionPart;
        return await qqguild.sendMessage(ChannelId,session.elements);
      }
    } else {
      ChannelId = domain.qqChannelId;
    }
    //@ts-ignore
    let msg: segment = <message />;
    let contain = await segment.transformAsync(raw, {
      async at(attrs) {
        if (attrs.id === qqguild.selfId) {
          return "";
        }
        let name = "";
        name = attrs.name;
        return `(@${name}) `;
      },
      text(attrs) {
        attrs.content = attrs.content.replace(/^(\d+)\./, '$1\u200B.')
        let matchURL = /\b((?:[a-z][\w-]+:(?:\/{1,3}|[a-z0-9%])|www\d{0,3}[.]|[a-z0-9.\-]+[.][a-z]{2,4}\/)(?:[^\s()<>]+|\(([^\s()<>]+|(\([^\s()<>]+\)))*\))+(?:\(([^\s()<>]+|(\([^\s()<>]+\)))*\)|[^\s`!()\[\]{};:'".,<>?«»“”‘’]))/g
        attrs.content = attrs.content.replace(matchURL,(match) => {
          let url = new URL(match)
          return url.href
            .replace(/\./g, ',')
            .replace(/\//g, '\u2044');
        })
        if (session.event._data.d?.referenced_message) {
          let author = session.event._data.d.referenced_message.author.username;
          let msg_ = session.event._data.d.referenced_message.content;
          if (msg_.length>15) {
            msg_ = `${msg_.slice(0, 15)}……`
          }
          if (session.event._data.d.referenced_message?.attachments) {
            session.event._data.d.referenced_message.attachments.map((attachment) => {
              msg_ += attachment.filename;
              msg_ += ' '
            })
          }
          return `\u21B1${author}:${msg_}\n${attrs.content}`
        }else if ((session.platform === 'kook')&&session.event.message?.quote){
          let author = session.event.message.quote.user.name;
          let msg_:string;
          if (session.event.message.quote?.content) {
            msg_ = session.event.message.quote.content;
            if (msg_.length>15) {
              msg_ = `${msg_.slice(0, 15)}……`
            }
          }
          let type_:string;
          try{
            session.event.message.quote.elements.find((element) => {
              if (element?.type !== 'text' || 'at') {
                type_ = element.type;
              }
            })
          }catch (e) {}
          if (type_) msg_ = `[${type_}]`;
          return `\u21B1${author}:${msg_}\n${session.event.user.name}:\n${attrs.content}`
        }
        return `${session.event.user.name}:\n${attrs.content}`;
      }
    });
    //@ts-ignore
    msg.children = [...msg.children, ...contain];
    return await qqguild.sendMessage(ChannelId, msg);
  }

  const raw = await getRaw(session);
  if (domain) {
    if (session.platform === 'kook') {
      if (raw[1]) {
        let r = processCard(raw[1])
        let result = await Promise.all(
          [
            sendDiscord(r.children,config,{domain: domain},update),
            sendQQGuild(r.children,config, {domain: domain},update)
          ]
        );
        let dcMsgId = result[0].id
        if (update == '') {
          //@ts-ignore
          await ctx.database.create("relayings", {
            kook: session.messageId,
            discord: JSON.stringify(dcMsgId),
            following: domain.discordChannelId,
            from: 'kook'
          });
        }
      }else{
        let result = await Promise.all(
          [
            sendDiscord(raw[0],config,{domain: domain},update),
            sendQQGuild(raw[0],config, {domain: domain},update)
          ]
        );
        let dcMsgId = result[0].id
        if (update == '') {
          //@ts-ignore
          await ctx.database.create("relayings", {
            kook: session.messageId,
            discord: JSON.stringify(dcMsgId),
            following: domain.discordChannelId,
            from: 'kook'
          });
        }
      }
    }
    if (session.platform === 'discord') {
      let result = await Promise.all(
        [
          sendKook(raw[0],config,{domain: domain},update),
          sendQQGuild(raw[0],config, {domain: domain},update)
        ]
      );
      if (update == '') {
        //@ts-ignore
        await ctx.database.create("relayings", {
          //@ts-ignore
          kook: result[0].msg_id,
          discord: session.messageId,
          following: domain.kookChannelId,
          from: 'discord'
        });
      }
    }
    if (session.platform === 'qqguild') {
      await Promise.all(
        [
          sendDiscord(raw[0],config,{domain: domain},update),
          sendKook(raw[0],config,{domain: domain},update)
        ]
      );
    }
  }else if (destination.destinationChannel) {
    if (raw[1]) {
      let rec = {
        type: "context",
        elements: [
          {
            type: "image",
            //@ts-ignore
            src: `${await transformUrl(<image url={session.author.avatar}></image>)}`
          },
          {
            type: "kmarkdown",
            content: `**${session.author.name}** 今天 ${unixToBeijing(session.event.timestamp)}`
          }
        ]
      }
      let r = JSON.parse(raw[1])
      r[0].modules.unshift(rec)
      let result = await Promise.all(destination.destinationChannel.map(async (channel) => {
        let response = await kook.internal.createMessage({
          type:Type.card,
          target_id:channel,
          content:JSON.stringify(r)
        });
        return response.msg_id;
      }));
      let region_:region = {
        platform:'kook',
        ChannelId:destination.destinationChannel
      }
      if (update == '') {
        //@ts-ignore
        await ctx.database.create("region_relayings", {
          region: JSON.stringify(region_),
          main: session.messageId,
          message: JSON.stringify(result)
        });
      }
    }else {
      if (session.platform === 'kook') {
        let result = await Promise.all(destination.destinationChannel.map(async (channel) => {
          let response:any = await sendKook(session.elements,config,{regionPart:channel},update);
          return response.msg_id;
        }));
        let region_:region = {
          platform:'kook',
          ChannelId:destination.destinationChannel
        }
        if (update == '') {
          //@ts-ignore
          await ctx.database.create("region_relayings", {
            region: JSON.stringify(region_),
            main: session.messageId,
            message: JSON.stringify(result)
          });
        }
      }
      if (session.platform === 'discord') {
        let result = await Promise.all(destination.destinationChannel.map(async (channel) => {
          let response = await sendDiscord(session.elements,config,{regionPart:channel},update);
          return response.id;
        }));
        let region_:region = {
          platform:'discord',
          ChannelId:destination.destinationChannel
        }
        if (update == '') {
          //@ts-ignore
          await ctx.database.create("region_relayings", {
            region: JSON.stringify(region_),
            main: session.messageId.toString(),
            message: JSON.stringify(result)
          });
        }
      }
      if (session.platform === 'qqguild') {
        await Promise.all(destination.destinationChannel.map(async (channel) => {
          return await sendQQGuild(session.elements,config,{regionPart:channel},update);
        }));
      }
    }
  }
}
