"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

import {Context, Schema, segment} from 'koishi'
import {relay} from './codec'
import {readFileSync,writeFileSync} from "fs";
import {parse, stringify} from "yaml";
import {KookBot} from "@koishijs/plugin-adapter-kook";
import {DiscordBot} from "@koishijs/plugin-adapter-discord";
import {Webhook} from "@satorijs/adapter-discord/src/types/webhook";
import {User as UserA} from "@satorijs/adapter-discord/src/types/user";
import {access, constants, mkdir} from "node:fs";

export const name = 'nakuru-relay'
export const inject = ['database']

export type messageId = string | string[];
export interface RelayTable {
  id: number;
  kook:string;
  discord:string;
  following:string;
  from:string;
}
export interface region_relayTable {
  id:number;
  region:region;
  main:messageId;
  message:messageId;
}

declare module "koishi" {
  interface relayings {
    relays: RelayTable;
  }
  interface region_relayings {
    region_relays: region_relayTable;
  }
}
export interface Config {
  domains: domain[];
  regions: region[];
  proxy:   string;
}
export interface domain {
  discordGuildId?: string;
  discordChannelId?: string;
  kookGuildId?:string;
  kookChannelId?:string;
  qqGuildId?:string;
  qqChannelId?:string;
}
export interface destination {
  destinationPlat:string;
  destinationChannel:string[];
}
export interface region {
  platform:string;
  ChannelId: string[];
}
export interface UserB {
  global_name: string;
  avatar_decoration_data: string;
  banner_color: string;
}
type User = UserA & UserB
type webhook = Omit<Webhook, 'user'> & { user: User };
export type webhooks = webhook[]
export const Config: Schema = Schema.object({
  domains: Schema.array(
    Schema.object({
      discordGuildId:   Schema.string(),
      discordChannelId: Schema.string(),
      kookGuildId:      Schema.string(),
      kookChannelId:    Schema.string(),
      qqGuildId:        Schema.string(),
      qqChannelId:      Schema.string(),
    }).collapse(),
  ).description('平台间互联，群组号选填'),
  regions: Schema.array(
    Schema.object({
      platform:  Schema.union(['discord', 'kook', 'qqguild']),
      ChannelId: Schema.array(
        Schema.string()
      ).collapse(),
    }).collapse()
  ).description('平台内互联'),
  proxy: Schema.string().description('代理地址'),
});
export async function apply(ctx: Context, config: Config) {
  const dcBot = ctx.bots.find(bt => bt.platform === 'discord') as unknown as DiscordBot;
  const kookBot = ctx.bots.find(bt => bt.platform === 'kook') as unknown as KookBot;
  const log = ctx.logger('domain')
  //@ts-ignore
  ctx.model.extend("relayings",
    {
      id: 'unsigned',
      kook: 'messageId',
      discord: 'messageId',
      following: 'string',
      from:'string'
    },
    {
      autoInc: true,
    }
  );
  //@ts-ignore
  ctx.model.extend("region_relayings",
    {
      id:'unsigned',
      region:'region',
      main:'messageId',
      message:'messageId'
    },
    {
      autoInc:true
    }
  )
  const file = readFileSync('./koishi.yml', 'utf-8');
  const cache = parse(file);
  let set, k, n;
  Object.keys(cache.plugins).forEach(groupKey => {
    const group = cache.plugins[groupKey];
    const regex = /dclike-domain/;
    Object.keys(group).forEach(v => {
      if (regex.test(v) === true) {
        set = group[v];
        k = groupKey;
        n = v;
      }
      //set === cache.plugin[k][n] === config
    });
  });
  access("webhooks.yml", constants.F_OK, (err) => {
    if (err) {
      if (err.code === 'ENOENT') {
        mkdir("webhooks.yml", () => {
          log.info('mkdir webhooks.yml for plugin')
        })
      } else {
        return;
      }
    }
  });
  let webhooks = parse(readFileSync('webhooks.yml','utf-8'))
  let webhookChannelId:string[] = [];
  if (webhooks) {
    webhookChannelId = webhooks.map(webhook => {
      return webhook.channel_id;
    });
  } else {
    webhooks = [];
  }
  if (config.domains) {
    for (let domain of config.domains) {
      if ((!webhookChannelId)||(!webhookChannelId.includes(domain.discordChannelId))) {
        await new Promise(resolve => setTimeout(resolve,1500));
        webhookChannelId.push(domain.discordChannelId);
        let wh_ = await dcBot.internal.getChannelWebhooks(domain.discordChannelId);
        if (wh_.length > 0) {
          webhooks.push(wh_[0]);
        }else{
          let wh1 = await dcBot.internal.createWebhook(domain.discordChannelId,{name:'Nakuru'});
          log.info("got webhook for channel %o",wh1.channel_id)
          webhooks.push(wh1);
        }
      }
    }
  }
  if (config.regions) {
    for (let region of config.regions) {
      if (region.platform === 'discord') {
        for (let id of region.ChannelId) {
          if (((!webhookChannelId)||(!webhookChannelId.includes(id)))) {
            await new Promise(resolve => setTimeout(resolve, 1500));
            webhookChannelId.push(id);
            let wh = await dcBot.internal.getChannelWebhooks(id);
            if (wh.length > 0) {
              webhooks.push(wh[0]);
            }else{
              let wh2 =  await dcBot.internal.createWebhook(id, {name: 'Nakuru'});
              log.info("got webhook for channel %o",wh2.channel_id)
              webhooks.push(wh2);
            }
          }
        }
      }
    }
  }
  writeFileSync('webhooks.yml',stringify(webhooks),'utf-8');
  let webhooksIDs = webhooks.map(webhook => webhook.id)
  //clear guild webhooks
  /*const dcBot = ctx.bots.find(bt => bt.platform === 'discord') as unknown as DiscordBot;
  let d = await dcBot.internal.getGuildWebhooks('**********')
  writeFileSync('./webhooks.yml', stringify(d), 'utf-8');*/
  /*async function processWebhooks() {
    let webs = readFileSync('./webhooks.yml','utf-8');
    let web = parse(webs);
    for (let webhook of web) {
      await new Promise(resolve => setTimeout(resolve, 500));
      await dcBot.internal.deleteWebhook(webhook.id);
    }
  }
  processWebhooks().catch(console.error);*/
  //view local settings
  ctx
    .platform("discord", "qqguild", "kook")
    .exclude(session => session.selfId === session.userId)
    .on('message', (async session => {
      const regex = /查看关联组/
      const re = /同步帮助/
      if (regex.test(session.content)) {
        let i = 0,j = 0;
        await session.send(`已有关联组:\n\n${config.domains
          .map(v => `  平台间关联组${i++}:${JSON.stringify(v, null, 2)
            .replace(/"/g, '')
            .replace('{', '')
            .replace('}', '')}`).join('\n\n')}\n\n${config.regions
          .map(v => `  平台内关联组${j++}:${JSON.stringify(v, null, 2)
            .replace(/"/g, '')
            .replace('{', '')
            .replace('}', '')
            .replace('[','')
            .replace(']','')}`).join('\n')}`)
      }
      if (re.test(session.content)) {
        await session.send(
          '指令目录' +
          '\n' +
          '1:查看关联组' +
          '\n' +
          '2:添加关联组+' +
          '\n' +
          '   1）依次输入discordGuildId, discordChannelId,' +
          '\n' +
          '                 kookGuildId, kookChannelId,' +
          '\n' +
          '                 qqGuildId, qqChannelId,' +
          '\n' +
          '   用逗号分隔' +
          '\n' +
          '   每个平台选填guildId,必填channelId,' +
          '\n' +
          '   至少要包含两个平台,用-表示该选项位置为空' +
          '\n' +
          '   2)kook/discord/qqguild三者之一' +
          '\n' +
          '    +逗号分隔的多个频道号' +
          '\n' +
          '   使用inspect查看当前频道信息' +
          '\n' +
          '3:删除关联组' +
          '\n' +
          '   1)删除平台间关联组+索引号' +
          '\n' +
          '   2)删除平台内关联组+索引号')
      }
    }));
  //edit settings
  ctx
    .platform("discord", "qqguild", "kook")
    .exclude(session => session.selfId === session.userId)
    .on('message', (session => {
      const regex = /添加关联组/;
      const re1 = /删除平台间关联组/;
      const re2 = /删除平台内关联组/
      if (re1.test(session.content)) {
        let num = session.content.match(/\d/)[0];
        set.domains.splice(~~num, ~~num + 1);
        cache.plugins[k][n] = set;
        writeFileSync('./koishi.yml', stringify(cache), 'utf-8');
        session.send(`已删除平台间关联组${num}`).then(r => {
        });
      } else if (re2.test(session.content)) {
        let num = session.content.match(/\d/)[0];
        set.regions.splice(~~num, ~~num + 1);
        cache.plugins[k][n] = set;
        writeFileSync('./koishi.yml', stringify(cache), 'utf-8');
        session.send(`已删除平台内关联组${num}`).then(r => {
        });
      }

      if (regex.test(session.content)) {
        if (/(kook|discord|qqguild)/.test(session.content)) {
          const regex = /(kook|discord|qqguild)/;
          const match = session.content.match(regex);
          let matches = session.content.match(/([\d\-]+(?:[,\uFF0C],[\d\-]+)*)/g);
          set.regions.push({
            platform: match[0],
            ChannelId: matches
          });
          cache.plugins[k][n] = set;
          writeFileSync('./koishi.yml', stringify(cache), 'utf-8');
          session.send('添加成功');
        } else {
          let matches = session.content.match(/([\d\-]+(?:[,\uFF0C],[\d\-]+)*)/g);
          let check = 0;
          for (let i = 0; i < 6; i++) {
            if (/^\d+$/.test(matches[i])) {
              check++;
            } else if (/^-$/.test(matches[i])) {
              check++;
              matches[i] = '';
            }
          }
          if (check === 6) {
            let [discordGuildId, discordChannelId, kookGuildId, kookChannelId, qqGuildId, qqChannelId] = matches;
            set.domains.push({discordGuildId, discordChannelId, kookGuildId, kookChannelId, qqGuildId, qqChannelId});
            cache.plugins[k][n] = set;
            writeFileSync('./koishi.yml', stringify(cache), 'utf-8');
            session.send('添加成功');
          } else {
            session.send('发送同步帮助查看帮助信息');
          }
        }
      }
    }))
  //relay
  ctx
    .platform("discord", "qqguild", "kook")
    .exclude(
      session => session.selfId === session.userId
        || session.content.match(/同步帮助|查看关联组|添加关联组|删除平台间关联组|删除平台内关联组/) !== null||(session.selfId === session.userId)
        ||webhooksIDs.includes(session.userId))
    .on("message", (async session => {
      try {
        config.domains.forEach((domain) => {
          if (
            domain.discordChannelId === session.channelId ||
            domain.kookChannelId === session.channelId ||
            domain.qqChannelId === session.channelId
          ) {
            relay(session, ctx, config, {domain: domain},'',webhooks);
          }
        });
        config.regions.forEach((region) => {
          if (
            region.ChannelId && region.ChannelId.includes(session.channelId)
          ) {
            let destination: destination = {
              destinationPlat: region.platform,
              destinationChannel: region.ChannelId.filter(item => item !== session.channelId)
            }
            relay(session, ctx, config, {destination: destination},'',webhooks);
          }
        });
      } catch (error) {
        log.info("ERROR %o",error);
      }
    }));
  ctx
    .platform("kook", "discord")
    .exclude(session => session.selfId === session.userId||webhooksIDs.includes(session.userId))
    .on('message-deleted', (async session => {
      try{
        let bind;
        if (session.platform === 'kook') {
          //@ts-ignore
          bind = await ctx.database.get('relayings', {kook: {$eq: session.event._data.extra.body.msg_id}});
          bind.map( b => {
            if (b.from === 'kook') {
              let webhook = webhooks.find(webhook => webhook.channel_id === b.following);
              dcBot.internal.deleteWebhookMessage(webhook.id,webhook.token,JSON.parse(b.discord),{thread_id:null})
            }
            //@ts-ignore
            ctx.database.remove('relayings', {id: {$eq: b.id}});
          });
        } else if (session.platform === 'discord') {
          //@ts-ignore
          bind = await ctx.database.get('relayings', {discord: {$eq: session.messageId}});
          bind.map( b => {
            if (b.from === 'discord') {
              kookBot.deleteMessage(b.following, b.kook)
            }
            //@ts-ignore
            ctx.database.remove('relayings', {id: {$eq: b.id}});
          });
        }

      }catch (e) {
        console.log(e)
      }
      try {
        let bind;
        if (session.platform === 'kook') {
          //@ts-ignore
          bind = await ctx.database.get('region_relayings', {main: {$eq: session.event._data.extra.body.msg_id}});
          bind.map( bS => {
            let b = {
              id:bS.id,
              region:JSON.parse(bS.region),
              main:bS.main,
              message:JSON.parse(bS.message)
            }
            if ((b.region.platform === 'kook')) {
              const subBind = b.region.ChannelId
                .map((cid,index) => [cid,b.message[index]]);
              subBind.forEach( c_m => {
                kookBot.deleteMessage(c_m[0],c_m[1]);
              })
              //@ts-ignore
              ctx.database.remove('region_relayings', {id: {$eq: b.id}});
            }
          });
        } else if (session.platform === 'discord') {
          //@ts-ignore
          bind = await ctx.database.get('region_relayings', {main: {$eq: session.messageId}});
          bind.map( bS => {
            let b = {
              id:bS.id,
              region:JSON.parse(bS.region),
              main:bS.main,
              message:JSON.parse(bS.message)
            }
            if ((b.region.platform === 'discord')) {
              const subBind = b.region.ChannelId
                .map((cid,index) => [cid,b.message[index]]);
              subBind.forEach( c_m => {
                let webhook = webhooks.find(webhook => webhook.channel_id === c_m[0]);
                dcBot.internal.deleteWebhookMessage(webhook.id,webhook.token,c_m[1],{thread_id:null});
              })
              //@ts-ignore
              ctx.database.remove('region_relayings', {id: {$eq: b.id}});
            }
          });
        }
      }catch (e) {
        console.log(e)
      }
    }));
  ctx
    .platform("kook", "discord")
    .exclude(session => session.selfId === session.userId)
    .on('message-updated', (async session => {
      try{
        let bind;
        if (session.platform === 'kook') {
          //@ts-ignore
          bind = await ctx.database.get('relayings', {kook: {$eq: session.event._data.extra.body.msg_id}});
          bind.map( async b => {
            if (b.from === 'kook') {
              let msg = await kookBot.internal.getMessageView({msg_id:b.kook})
              let session_ = {
                platform: 'kook',
                elements: [segment.text(session.event._data.extra.body.content)],
                author:
                  {
                    nickname:msg.author.nickname,
                    avatar:msg.author.avatar,
                    username:msg.author.username
                  },
                event:
                  {
                    message:
                      {
                        quote:msg.quote
                      },
                    timestamp: session.event._data.msg_timestamp
                  }
              }
              relay(session_, ctx, config, {domain: {discordChannelId: b.following}}, JSON.parse(b.discord), webhooks)
            }
          });
        } else if (session.platform === 'discord') {
          //@ts-ignore
          bind = await ctx.database.get('relayings', {discord: {$eq: session.messageId}});
          bind.map( b => {
            if (b.from === 'discord') {
              relay(session,ctx, config, {domain: {kookChannelId:b.following}},b.kook)
            }
          });
        }
      }catch (e) {
        console.log(e)
      }
      try {
        let bind;
        if (session.platform === 'kook') {
          //@ts-ignore
          bind = await ctx.database.get('region_relayings', {main: {$eq: session.event._data.extra.body.msg_id}});
          bind.map( async bS => {
            let b = {
              id: bS.id,
              region: JSON.parse(bS.region),
              main: bS.main,
              message: JSON.parse(bS.message)
            }
            if ((b.region.platform === 'kook')) {
              let msg = await kookBot.internal.getMessageView({msg_id: b.main});
              let session_ = {
                platform: 'kook',
                elements: [segment.text(session.event._data.extra.body.content)],
                author:
                  {
                    nickname: msg.author.nickname,
                    avatar: msg.author.avatar,
                    name: msg.author.username
                  },
                event:
                  {
                    message:
                      {
                        quote: msg.quote
                      },
                    timestamp: session.event._data.msg_timestamp
                  }
              }
              const subBind = b.region.ChannelId
                .map((cid, index) => [cid, b.message[index]]);
              subBind.forEach( c_m => {
                relay(session_, ctx, config, {destination: {destinationPlat: b.region.platform, destinationChannel: [c_m[0]]}}, c_m[1])
              })
            }
          });
        } else if (session.platform === 'discord') {
          //@ts-ignore
          bind = await ctx.database.get('region_relayings', {main: {$eq: session.messageId}});
          bind.map( bS => {
            let b = {
              id:bS.id,
              region:JSON.parse(bS.region),
              main:bS.main,
              message:JSON.parse(bS.message)
            }
            if ((b.region.platform === 'discord')) {
              const subBind = b.region.ChannelId
                .map((cid,index) => [cid,b.message[index]]);
              subBind.forEach( c_m => {
                relay(session,ctx, config, {destination: {destinationPlat: b.region.platform, destinationChannel: [c_m[0]]}},c_m[1],webhooks)
              })
            }
          });
        }
      }catch (e) {
        console.log(e)
      }
    }));
}
