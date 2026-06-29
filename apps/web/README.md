# Web 前端

用于任务输入、实时智能体时间线、权限审批和交付物预览。

## 技术栈

- React
- Vite
- TypeScript
- Tailwind CSS

## 本地开发

```bash
npm run dev:web
```

默认启动在 `http://127.0.0.1:5173`，并将 `/api` 代理到 `http://127.0.0.1:3001`。

## 构建

```bash
npm run build:web
```

构建产物输出到 `apps/web/dist`。API 服务会优先读取该目录；如果没有构建产物，则回退到旧的 `apps/web/public`。
