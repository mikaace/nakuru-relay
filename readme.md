# koishi-plugin-nakuru-relay

[![npm](https://img.shields.io/npm/v/koishi-plugin-nakuru-relay?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-nakuru-relay)

转发、同步discord,kook,qq频道的消息发送和编辑、删除

##### koishi插件，多平台消息互通
***
### 部署
+ 在koishi中安装
+ 安装并配置你需要的平台的驱动器
+ 编辑插件配置
***
### 使用
+ 发送同步帮助以了解
+ 由于API比较屎暂不支持QQ方面的消息编辑/删除,仅进行转发
+ 由于在Discord使用伪造头像名称，需要全程使用webhook才能编辑消息，多余webhook可以在discord机器人右键app-管理集成中删除
### 效果展示
Discord -> Kook

![图片描述](./assets/屏幕截图%202023-12-18%20182124.png)
![图片描述](./assets/屏幕截图%202023-12-18%20182139.png)

Kook -> Discord

![图片描述](./assets/屏幕截图%202023-12-18%20182339.png)
![图片描述](./assets/屏幕截图%202023-12-18%20182356.png)
***
### TODO
+ 回复消息使用指令进行特定消息的转发
+ 在上一条的基础上合并转发
### Bug
+ Discord使用editWebhookMessage时没能同步删除附件
