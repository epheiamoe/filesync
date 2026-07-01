# Plan：消息过期销毁提示重写

详见 `.swarm/2026-07-01_message-expired-toast/plan.md`。

## 目标

将「消息/文件已过期销毁」提示从无限堆叠 toast 重写为单一 iMessage 风格聚合卡片。

## 关键设计点

- 单一聚合卡片（顶部固定显示），iMessage 风格堆叠。
- 1 分钟滚动窗口计数器。
- 10 秒空闲自动退出、上滑/关闭立即退出。
- 彻底替换旧 `chat.messageExpired` / `chat.fileExpired` 单条 toast。

## 交付物

- `.swarm/2026-07-01_message-expired-toast/architecture.md`
- 代码修改（由 @implementer-heavy 执行）
- 测试与审查报告
