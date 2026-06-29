import { useEffect, useMemo, useState } from "react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useMessagePartText,
  useExternalStoreRuntime,
  type AppendMessage,
} from "@assistant-ui/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Blocks,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  NotebookTabs,
  Search,
  SendHorizontal,
  Sparkles,
  SquarePen,
  UserRound,
} from "lucide-react";

import { createTask, listTasks, sendTaskMessage, subscribeTaskEvents } from "./api/tasks";
import {
  appendTaskEvent,
  appendUserMessage,
  createEmptySession,
  hydrateTaskSession,
  statusTitle,
} from "./runtime/transcript";
import { toAssistantUiMessages } from "./runtime/assistant-ui-adapter";
import { formatElapsedTime } from "./runtime/time-format";
import type { AgentSessionView, AgentTask, TaskEvent, TaskStatus, TranscriptMessage } from "./types";

export function App() {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [session, setSession] = useState<AgentSessionView>(() => createEmptySession());
  const [isSending, setIsSending] = useState(false);

  const activeTask = useMemo(
    () => tasks.find((task) => task.id === activeTaskId) ?? null,
    [activeTaskId, tasks],
  );

  useEffect(() => {
    listTasks().then(async (loadedTasks) => {
      setTasks(loadedTasks);
      if (loadedTasks[0]) {
        await selectTask(loadedTasks[0], loadedTasks);
      }
    });
  }, []);

  async function sendMessage(value: string) {
    if (!value || isSending) {
      return;
    }

    setIsSending(true);

    try {
      const taskBeforeSend = activeTaskId ? tasks.find((task) => task.id === activeTaskId) : null;
      const previousLastEventId = taskBeforeSend?.events?.at(-1)?.id;
      const result = activeTaskId
        ? await sendTaskMessage(activeTaskId, value)
        : { task: await createTask(value), messageId: undefined };
      const { task, messageId } = result;
      setActiveTaskId(task.id);
      setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
      setSession((current) => (activeTaskId ? appendUserMessage(current, value, messageId) : hydrateTaskSession(task)));

      const source = subscribeTaskEvents(
        task.id,
        async (message) => {
          const event = JSON.parse(message.data) as TaskEvent;
          setSession((current) => appendTaskEvent(current, event));

          if (event.status === "completed" || event.status === "failed") {
            source.close();
            setIsSending(false);
            const loadedTasks = await listTasks();
            setTasks(loadedTasks);
          }
        },
        () => {
          source.close();
          setIsSending(false);
          setSession((current) =>
            appendTaskEvent(current, {
              type: "stream-error",
              status: "failed",
              title: "事件流中断",
              message: "可以重新发送消息，或稍后继续查看任务结果。",
              timestamp: new Date().toISOString(),
            }),
          );
        },
        previousLastEventId,
      );
    } catch (error) {
      setIsSending(false);
      setSession((current) =>
        appendTaskEvent(current, {
          type: "create-error",
          status: "failed",
          title: "创建失败",
          message: error instanceof Error ? error.message : "任务创建失败",
          timestamp: new Date().toISOString(),
        }),
      );
    }
  }

  async function selectTask(task: AgentTask, sourceTasks = tasks) {
    setActiveTaskId(task.id);
    setTasks(sourceTasks);
    setSession(hydrateTaskSession(task));
  }

  return (
    <main className="grid h-screen min-h-[720px] grid-cols-[300px_minmax(0,1fr)] overflow-hidden bg-[#f4f6f6] text-[#202124] max-[860px]:grid-cols-1 max-[860px]:grid-rows-[auto_minmax(0,1fr)]">
      <ProjectSidebar
        tasks={tasks}
        activeTaskId={activeTaskId}
        onNewChat={() => {
          setActiveTaskId(null);
          setSession(createEmptySession());
        }}
        onSelectTask={(task) => selectTask(task)}
      />

      <section className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] bg-white">
        <ChatHeader status={session.status} title={session.title} summary={session.summary} />
        <AgentChat
          disabled={isSending}
          messages={session.messages}
          onSend={(value) => sendMessage(value)}
          status={session.status}
        />
      </section>
    </main>
  );
}

function ProjectSidebar({
  tasks,
  activeTaskId,
  onNewChat,
  onSelectTask,
}: {
  tasks: AgentTask[];
  activeTaskId: string | null;
  onNewChat: () => void;
  onSelectTask: (task: AgentTask) => void;
}) {
  return (
    <aside className="min-w-0 overflow-auto border-r border-[#e1e4e5] bg-[#f4f6f6] px-0 py-4 max-[860px]:max-h-72 max-[860px]:border-b max-[860px]:border-r-0">
      <div className="mb-7 flex h-7 items-center gap-4 px-3 text-[#8c9294]">
        <span className="grid size-6 place-items-center rounded-md border border-[#b8bec0] text-[#656b6d]">
          <NotebookTabs size={15} />
        </span>
        <ChevronLeft size={22} strokeWidth={1.8} />
        <ChevronRight className="text-[#c3c8c9]" size={22} strokeWidth={1.8} />
      </div>

      <nav className="mb-8 grid gap-1 px-3">
        <SidebarNavButton icon={<SquarePen size={18} />} label="新对话" onClick={onNewChat} />
        <SidebarNavButton icon={<Search size={19} />} label="搜索" />
        <SidebarNavButton icon={<CalendarClock size={18} />} label="已安排" />
        <SidebarNavButton icon={<Blocks size={18} />} label="插件" />
      </nav>

      <section>
        <div className="mb-4 px-3 text-sm font-semibold text-[#9aa0a2]">项目</div>
        <div className="grid gap-3">
          <ProjectGroup
            activeTaskId={activeTaskId}
            name="agent-desk"
            tasks={tasks}
            onSelectTask={onSelectTask}
          />
        </div>
      </section>
    </aside>
  );
}

function SidebarNavButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <button
      className="flex min-h-10 items-center gap-3 rounded-lg px-1 text-left text-[17px] font-semibold text-[#3f4648] transition hover:bg-[#eceff0]"
      type="button"
      onClick={onClick}
    >
      <span className="grid size-7 place-items-center text-[#566063]">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function ProjectGroup({
  activeTaskId,
  name,
  tasks,
  onSelectTask,
}: {
  activeTaskId: string | null;
  name: string;
  tasks: AgentTask[];
  onSelectTask: (task: AgentTask) => void;
}) {
  return (
    <div className="grid gap-1">
      <div className="flex min-h-9 items-center gap-3 px-3 text-[16px] font-semibold text-[#3f4648]">
        <NotebookTabs className="shrink-0 text-[#566063]" size={18} />
        <span className="truncate">{name}</span>
      </div>

      <div className="grid gap-0.5 pl-9 pr-3">
        {tasks.length === 0 ? (
          <p className="px-2 py-1 text-[15px] font-medium text-[#9aa0a2]">暂无对话</p>
        ) : null}
        {tasks.map((task) => (
          <button
            className={`grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 text-left text-[16px] transition ${
              task.id === activeTaskId ? "bg-[#e5e9e9]" : "hover:bg-[#eceff0]"
            }`}
            key={task.id}
            type="button"
            onClick={() => onSelectTask(task)}
          >
            <span className="truncate font-medium text-[#303638]">{task.prompt}</span>
            <span className="text-[15px] font-medium text-[#9aa0a2]">{formatRelativeTaskTime(task)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatHeader({ status, title, summary }: { status: TaskStatus; title: string; summary: string }) {
  return (
    <header className="flex min-h-[57px] items-center justify-between gap-5 border-b border-[#eceeef] bg-white px-6 py-2 max-[860px]:flex-col max-[860px]:items-stretch max-[860px]:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <NotebookTabs className="shrink-0 text-[#303638]" size={20} />
        <h1 className="truncate text-[17px] font-semibold">AgentDesk</h1>
        <button className="grid size-8 place-items-center rounded-md text-[#9aa0a2] hover:bg-[#f1f3f3]" type="button">
          <MoreHorizontal size={20} />
        </button>
      </div>
      <div className="flex min-w-52 items-center gap-2 rounded-lg px-2 py-1 max-[860px]:min-w-0">
        <StatusIcon status={status} />
        <div className="min-w-0">
          <strong className="block truncate text-xs font-semibold text-[#596063]">{title}</strong>
          <small className="block truncate text-xs text-[#9aa0a2]">{summary}</small>
        </div>
      </div>
    </header>
  );
}

function AgentChat({
  disabled,
  messages,
  onSend,
  status,
}: {
  disabled: boolean;
  messages: TranscriptMessage[];
  onSend: (value: string) => Promise<void>;
  status: TaskStatus;
}) {
  const assistantMessages = useMemo(() => toAssistantUiMessages(messages), [messages]);
  const runtime = useExternalStoreRuntime({
    messages: assistantMessages,
    convertMessage: (message) => message,
    isRunning: status === "running" || status === "queued",
    isSendDisabled: disabled,
    onNew: async (message: AppendMessage) => {
      await onSend(messageText(message));
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
        <ThreadPrimitive.Root className="min-h-0 overflow-hidden">
          <ThreadPrimitive.Viewport className="h-full overflow-y-auto overflow-x-hidden">
            <div className="mx-auto flex max-w-5xl flex-col gap-9 px-10 py-8 pb-28 max-[860px]:px-5">
              <ThreadPrimitive.Messages components={{ Message: AssistantUiMessage }} />
            </div>
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
        <AssistantUiComposer />
      </div>
    </AssistantRuntimeProvider>
  );
}

function AssistantUiMessage() {
  return (
    <MessagePrimitive.Root>
      <MessagePrimitive.If user>
        <UserMessage />
      </MessagePrimitive.If>
      <MessagePrimitive.If assistant>
        <AssistantMessage />
      </MessagePrimitive.If>
    </MessagePrimitive.Root>
  );
}

function UserMessage() {
  return (
    <article className="flex flex-row-reverse gap-4">
      <div className="flex min-w-0 flex-1 justify-end">
        <div className="w-fit max-w-[78%]">
          <div className="grid gap-3 rounded-2xl bg-[#f1f2f2] px-5 py-3 text-[#202124]">
            <MessagePrimitive.Parts components={{ Text: UserTextPart }} />
          </div>
        </div>
      </div>
    </article>
  );
}

function AssistantMessage() {
  return (
    <article className="flex gap-4">
      <div className="min-w-0 flex-1">
        <div className="mb-5 flex items-center gap-2 text-[15px] font-semibold text-[#7f8588]">
          <span>已处理</span>
          <ElapsedMessageAge />
          <ChevronRight size={17} />
        </div>
        <div className="grid gap-3">
          <MessagePrimitive.Parts
            components={{
              Empty: AssistantEmptyPart,
              Text: MarkdownPart,
              Reasoning: AssistantUiReasoningPart,
              tools: {
                Fallback: AssistantToolPart,
              },
            }}
          />
        </div>
      </div>
    </article>
  );
}

function AssistantEmptyPart({ status }: { status: { type: string } }) {
  if (status.type !== "running") {
    return null;
  }

  return <ThinkingIndicator />;
}

function MessageTime() {
  const createdAt = useAuiState((state) => state.message.createdAt);
  const value = formatMessageTime(createdAt);

  if (!value) {
    return null;
  }

  return <span className="text-xs font-medium text-[#9aa0a2]">{value}</span>;
}

function ElapsedMessageAge() {
  const createdAt = useAuiState((state) => state.message.createdAt);
  if (!createdAt || Number.isNaN(createdAt.getTime())) {
    return null;
  }

  return <span>{formatRelativeTime(createdAt)}</span>;
}

function ThinkingIndicator() {
  const createdAt = useAuiState((state) => state.message.createdAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="flex w-fit items-center gap-2 rounded-full border border-[#e1e4e5] bg-white px-3 py-1.5 text-sm text-[#7f8588] shadow-sm">
      <Loader2 className="animate-spin" size={15} />
      <span>正在思考</span>
      <span className="font-mono text-xs text-[#9aa0a2]">{formatElapsed(createdAt, now)}</span>
    </div>
  );
}

function UserTextPart() {
  const part = useMessagePartText();
  return <p className="whitespace-pre-wrap text-[16px] font-semibold leading-7 text-[#202124]">{part.text}</p>;
}

function MarkdownPart() {
  const part = useMessagePartText();
  return (
    <div className="agent-markdown text-[16px] leading-8 text-[#202124]">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
    </div>
  );
}

function AssistantUiReasoningPart({ text }: { text: string }) {
  return (
    <details className="group rounded-xl border border-[#e1e4e5] bg-white text-[#202124] shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-medium">
        <span className="flex min-w-0 items-center gap-2">
          <Sparkles size={15} />
          <span className="truncate">思考过程</span>
        </span>
        <ChevronDown className="shrink-0 transition group-open:rotate-180" size={15} />
      </summary>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-[#e1e4e5] px-3 py-2 text-xs leading-5 text-[#596063]">
        {text}
      </pre>
    </details>
  );
}

function AssistantToolPart({
  toolName,
  args,
  result,
}: {
  toolName: string;
  args?: unknown;
  result?: unknown;
}) {
  return (
    <CollapsibleRunBlock
      icon={<Sparkles size={15} />}
      tone="amber"
      title={toolName}
      value={JSON.stringify({ args, result }, null, 2)}
    />
  );
}

function CollapsibleRunBlock({
  icon,
  title,
  value,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  tone: "amber" | "emerald" | "zinc";
}) {
  const toneClass = {
    amber: "border-[#e1e4e5] bg-[#f1f2f2] text-[#202124]",
    emerald: "border-[#e1e4e5] bg-[#f1f2f2] text-[#202124]",
    zinc: "border-[#e1e4e5] bg-white text-[#202124]",
  }[tone];

  return (
    <details className={`group rounded-xl border ${toneClass} shadow-sm`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-medium">
        <span className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate">{title}</span>
        </span>
        <ChevronDown className="shrink-0 transition group-open:rotate-180" size={15} />
      </summary>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-current/10 px-3 py-2 text-xs leading-5 text-current/80">
        {value || "无内容"}
      </pre>
    </details>
  );
}

function AssistantUiComposer() {
  return (
    <footer className="bg-white px-8 py-4 max-[860px]:px-5">
      <ComposerPrimitive.Root className="mx-auto max-w-5xl rounded-3xl border border-[#e1e4e5] bg-white p-3 shadow-[0_16px_45px_rgba(32,33,36,0.08)] focus-within:border-[#c8cdcf]">
        <ComposerPrimitive.Input
          className="min-h-20 w-full resize-none bg-transparent px-2 py-2 text-[15px] leading-7 outline-none"
          placeholder="要求后续变更"
        />
        <div className="flex items-center justify-between gap-3 border-t border-[#f0f1f1] pt-3">
          <span className="text-xs text-[#9aa0a2]">Enter 发送，Shift + Enter 换行</span>
          <ComposerPrimitive.Send
            className="flex min-h-9 items-center gap-2 rounded-xl bg-[#202124] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#303134] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <SendHorizontal size={16} />
            发送
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </footer>
  );
}

function messageText(message: AppendMessage) {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function formatMessageTime(value: Date | undefined) {
  if (!value || Number.isNaN(value.getTime())) {
    return "";
  }

  return value.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatElapsed(start: Date | undefined, now: number) {
  if (!start || Number.isNaN(start.getTime())) {
    return "0s";
  }

  const totalSeconds = Math.max(0, Math.floor((now - start.getTime()) / 1000));
  return formatElapsedTime(totalSeconds);
}

function formatRelativeTaskTime(task: AgentTask) {
  const value = task.updatedAt ?? task.createdAt;
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return formatRelativeTime(date);
}

function formatRelativeTime(date: Date) {
  const totalSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 1) {
    return "刚刚";
  }
  if (minutes < 60) {
    return `${minutes} 分`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 时`;
  }

  const days = Math.floor(hours / 24);
  return `${days} 天`;
}

function Avatar({ role }: { role: "user" | "assistant" }) {
  return (
    <div
      className={`grid size-10 shrink-0 place-items-center rounded-xl shadow-sm ${
        role === "user" ? "bg-white text-[#596063]" : "bg-[#303638] text-white"
      }`}
    >
      {role === "user" ? <UserRound size={18} /> : <Bot size={19} />}
    </div>
  );
}

function StatusIcon({ status }: { status: TaskStatus }) {
  if (status === "completed") {
    return <CheckCircle2 className="shrink-0 text-[#596063]" size={18} />;
  }

  if (status === "failed") {
    return <CircleAlert className="shrink-0 text-red-600" size={18} />;
  }

  if (status === "running" || status === "queued") {
    return <Loader2 className="shrink-0 animate-spin text-amber-600" size={18} />;
  }

  return <Bot className="shrink-0 text-zinc-500" size={18} />;
}

function StatusDot({ status }: { status: TaskStatus }) {
  return <span className={`size-2 rounded-full ${statusDotClass(status)}`} />;
}

function statusDotClass(status: TaskStatus) {
  if (status === "completed") {
    return "bg-[#596063]";
  }

  if (status === "failed") {
    return "bg-red-600";
  }

  if (status === "running" || status === "queued") {
    return "bg-amber-600";
  }

  return "bg-zinc-400";
}
