import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  groupPartByType,
  ThreadPrimitive,
  useAuiState,
  useMessagePartText,
  useExternalStoreRuntime,
  type AppendMessage,
} from "@assistant-ui/react";
import {
  Blocks,
  Bot,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Copy,
  DatabaseZap,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  NotebookTabs,
  Search,
  SendHorizontal,
  X,
  WandSparkles,
  SquarePen,
} from "lucide-react";

import { createProject, createTask, listProjects, listTasks, renameProject, renameTask, sendTaskMessage, subscribeTaskEvents } from "./api/tasks";
import {
  appendTaskEvent,
  appendUserMessage,
  createEmptySession,
  hydrateTaskSession,
  statusTitle,
} from "./runtime/transcript";
import { toAssistantUiMessages } from "./runtime/assistant-ui-adapter";
import { summarizeTaskEvents } from "./runtime/event-debug";
import { transcriptMessageToCopyText } from "./runtime/message-copy";
import { formatRunElapsed, hasIntermediateProcess, intermediatePartEntries, isIntermediateProcessVisible, shouldRenderIntermediatePart } from "./runtime/intermediate-process";
import { formatElapsedTime, formatRelativeTime } from "./runtime/time-format";
import { MarkdownText } from "./components/assistant-ui/markdown-text";
import { Reasoning, ReasoningContent, ReasoningRoot, ReasoningText, ReasoningTrigger } from "./components/assistant-ui/reasoning";
import { ToolFallback, ToolFallbackArgs, ToolFallbackContent, ToolFallbackResult, ToolFallbackRoot, ToolFallbackTrigger } from "./components/assistant-ui/tool-fallback";
import { ToolGroupContent, ToolGroupRoot, ToolGroupTrigger } from "./components/assistant-ui/tool-group";
import type { AgentProject, AgentSessionView, AgentTask, MessagePart, TaskEvent, TaskStatus, TranscriptMessage } from "./types";

export function App() {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [projects, setProjects] = useState<AgentProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("agent-desk");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [session, setSession] = useState<AgentSessionView>(() => createEmptySession());
  const [isSending, setIsSending] = useState(false);
  const [isEventPanelOpen, setIsEventPanelOpen] = useState(false);

  const activeTask = useMemo(
    () => tasks.find((task) => task.id === activeTaskId) ?? null,
    [activeTaskId, tasks],
  );
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? { id: "agent-desk", name: "agent-desk" },
    [activeProjectId, projects],
  );

  useEffect(() => {
    Promise.all([listProjects(), listTasks()]).then(async ([loadedProjects, loadedTasks]) => {
      setProjects(ensureProjectsFromTasks(loadedProjects, loadedTasks));
      setTasks(loadedTasks);
      if (loadedTasks[0]) {
        setActiveProjectId(loadedTasks[0].project?.id ?? "agent-desk");
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
        : { task: await createTask(value, activeProjectId), messageId: undefined };
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
            setProjects((current) => ensureProjectsFromTasks(current, loadedTasks));
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
    setActiveProjectId(task.project?.id ?? "agent-desk");
    setTasks(sourceTasks);
    setSession(hydrateTaskSession(task));
  }

  async function addProject() {
    const name = window.prompt("项目名称");
    if (!name?.trim()) return;
    const project = await createProject(name.trim());
    setProjects((current) => [...current, project].sort((a, b) => a.name.localeCompare(b.name)));
    setActiveProjectId(project.id);
    setActiveTaskId(null);
    setSession(createEmptySession());
  }

  async function updateProjectName(project: AgentProject) {
    const name = window.prompt("项目名称", project.name);
    if (!name?.trim() || name.trim() === project.name) return;
    const result = await renameProject(project.id, name.trim());
    setProjects((current) => current.map((item) => (item.id === project.id ? result.project : item)));
    setTasks(result.tasks);
  }

  async function updateTaskTitle(task: AgentTask) {
    const title = window.prompt("会话名称", task.title ?? task.prompt);
    if (!title?.trim() || title.trim() === (task.title ?? task.prompt)) return;
    const updatedTask = await renameTask(task.id, title.trim());
    setTasks((current) => current.map((item) => (item.id === task.id ? updatedTask : item)));
    if (activeTaskId === task.id) {
      setSession(hydrateTaskSession(updatedTask));
    }
  }

  return (
    <main className="grid h-screen min-h-[720px] grid-cols-[300px_minmax(0,1fr)] overflow-hidden bg-[#f4f6f6] text-[#202124] max-[860px]:grid-cols-1 max-[860px]:grid-rows-[auto_minmax(0,1fr)]">
      <ProjectSidebar
        activeProjectId={activeProjectId}
        activeTaskId={activeTaskId}
        projects={projects}
        tasks={tasks}
        onAddProject={addProject}
        onNewChat={() => {
          setActiveTaskId(null);
          setSession(createEmptySession());
        }}
        onRenameProject={updateProjectName}
        onRenameTask={updateTaskTitle}
        onSelectProject={(project) => setActiveProjectId(project.id)}
        onSelectTask={(task) => selectTask(task)}
      />

      <section className="relative grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] bg-white">
        <ChatHeader
          eventCount={activeTask?.events?.length ?? 0}
          isEventPanelOpen={isEventPanelOpen}
          status={session.status}
          summary={session.summary}
          title={session.title}
          onToggleEvents={() => setIsEventPanelOpen((open) => !open)}
        />
        <AgentChat
          activeProject={activeProject}
          disabled={isSending}
          messages={session.messages}
          onSend={(value) => sendMessage(value)}
          projects={projects}
          status={session.status}
          onSelectProject={(project) => setActiveProjectId(project.id)}
        />
        <EventDebugPanel
          events={activeTask?.events ?? []}
          isOpen={isEventPanelOpen}
          onClose={() => setIsEventPanelOpen(false)}
        />
      </section>
    </main>
  );
}

function ProjectSidebar({
  activeProjectId,
  activeTaskId,
  projects,
  tasks,
  onAddProject,
  onNewChat,
  onRenameProject,
  onRenameTask,
  onSelectProject,
  onSelectTask,
}: {
  activeProjectId: string;
  activeTaskId: string | null;
  projects: AgentProject[];
  tasks: AgentTask[];
  onAddProject: () => void;
  onNewChat: () => void;
  onRenameProject: (project: AgentProject) => void;
  onRenameTask: (task: AgentTask) => void;
  onSelectProject: (project: AgentProject) => void;
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

      <ProjectThreadList
        activeProjectId={activeProjectId}
        activeTaskId={activeTaskId}
        groups={groupTasksByProject(projects, tasks)}
        onAddProject={onAddProject}
        onRenameProject={onRenameProject}
        onRenameTask={onRenameTask}
        onSelectProject={onSelectProject}
        onSelectTask={onSelectTask}
      />
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

function ProjectThreadList({
  activeProjectId,
  activeTaskId,
  groups,
  onAddProject,
  onRenameProject,
  onRenameTask,
  onSelectProject,
  onSelectTask,
}: {
  activeProjectId: string;
  activeTaskId: string | null;
  groups: ProjectThreadGroupModel[];
  onAddProject: () => void;
  onRenameProject: (project: AgentProject) => void;
  onRenameTask: (task: AgentTask) => void;
  onSelectProject: (project: AgentProject) => void;
  onSelectTask: (task: AgentTask) => void;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-4 flex items-center justify-between px-3 text-sm font-semibold text-[#9aa0a2]">
        <span>项目</span>
        <button className="grid size-7 place-items-center rounded-md transition hover:bg-[#eceff0] hover:text-[#596063]" type="button" onClick={onAddProject}>
          <Plus size={15} />
        </button>
      </div>
      <div className="grid gap-5">
        {groups.length === 0 ? (
          <p className="px-3 py-1 text-[15px] font-medium text-[#9aa0a2]">暂无项目</p>
        ) : null}
        {groups.map((group) => (
          <ProjectThreadGroup
            activeProjectId={activeProjectId}
            activeTaskId={activeTaskId}
            group={group}
            key={group.id}
            onRenameProject={onRenameProject}
            onRenameTask={onRenameTask}
            onSelectProject={onSelectProject}
            onSelectTask={onSelectTask}
          />
        ))}
      </div>
    </section>
  );
}

type ProjectThreadGroupModel = AgentProject & {
  tasks: AgentTask[];
};

const MAX_COLLAPSED_PROJECT_THREADS = 5;

function ProjectThreadGroup({
  activeProjectId,
  activeTaskId,
  group,
  onRenameProject,
  onRenameTask,
  onSelectProject,
  onSelectTask,
}: {
  activeProjectId: string;
  activeTaskId: string | null;
  group: ProjectThreadGroupModel;
  onRenameProject: (project: AgentProject) => void;
  onRenameTask: (task: AgentTask) => void;
  onSelectProject: (project: AgentProject) => void;
  onSelectTask: (task: AgentTask) => void;
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const hasMoreThreads = group.tasks.length > MAX_COLLAPSED_PROJECT_THREADS;
  const visibleTasks = isExpanded ? group.tasks : group.tasks.slice(0, MAX_COLLAPSED_PROJECT_THREADS);

  return (
    <div className="group/project grid gap-1">
      <div className="flex min-h-9 items-center gap-2 px-3 text-[17px] font-normal text-[#3f4648]">
        <button
          className="grid size-6 shrink-0 place-items-center rounded-md text-[#8d9496] transition hover:bg-[#eceff0] hover:text-[#596063]"
          type="button"
          onClick={() => setIsCollapsed((collapsed) => !collapsed)}
        >
          <ChevronRight className={isCollapsed ? "transition" : "rotate-90 transition"} size={15} />
        </button>
        <button
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          type="button"
          onClick={() => onSelectProject(group)}
          onDoubleClick={() => onRenameProject(group)}
        >
          <NotebookTabs className="shrink-0 text-[#566063]" size={18} strokeWidth={1.8} />
          <span className={activeProjectId === group.id ? "truncate text-[#202124]" : "truncate"}>{group.name}</span>
        </button>
        <button
          className="grid size-7 place-items-center rounded-md text-[#9aa0a2] opacity-0 transition hover:bg-[#eceff0] hover:text-[#596063] group-hover/project:opacity-100"
          type="button"
          onClick={() => onRenameProject(group)}
        >
          <Pencil size={14} />
        </button>
      </div>

      {!isCollapsed && visibleTasks.length > 0 ? (
        <div className="grid gap-0.5">
          {visibleTasks.map((task) => (
            <ProjectThreadItem
              isActive={task.id === activeTaskId}
              key={task.id}
              task={task}
              onRenameTask={onRenameTask}
              onSelectTask={onSelectTask}
            />
          ))}
          {hasMoreThreads ? (
            <button
              className="min-h-[42px] rounded-r-2xl py-1.5 pl-[60px] pr-4 text-left text-[16px] font-medium text-[#8d9496] transition hover:bg-[#eceff0] hover:text-[#596063]"
              type="button"
              onClick={() => setIsExpanded((expanded) => !expanded)}
            >
              {isExpanded ? "收起" : "展开显示"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ProjectThreadItem({
  isActive,
  task,
  onRenameTask,
  onSelectTask,
}: {
  isActive: boolean;
  task: AgentTask;
  onRenameTask: (task: AgentTask) => void;
  onSelectTask: (task: AgentTask) => void;
}) {
  const className = [
    "group/thread grid min-h-[42px] grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-r-2xl px-4 py-1.5 pl-[60px] text-left text-[16px] transition",
    isActive ? "bg-[#e5e9e9]" : "hover:bg-[#eceff0]",
  ].join(" ");

  return (
    <button
      className={className}
      type="button"
      onClick={() => onSelectTask(task)}
      onDoubleClick={() => onRenameTask(task)}
    >
      <span className="truncate font-normal text-[#303638]">{task.title ?? task.prompt}</span>
      <span className="shrink-0 text-[15px] font-medium text-[#8d9496]">{formatRelativeTaskTime(task)}</span>
      <span
        className="grid size-7 place-items-center rounded-md text-[#9aa0a2] opacity-0 transition hover:bg-[#dfe4e4] hover:text-[#596063] group-hover/thread:opacity-100"
        role="button"
        tabIndex={0}
        onClick={(event) => {
          event.stopPropagation();
          onRenameTask(task);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            onRenameTask(task);
          }
        }}
      >
        <Pencil size={14} />
      </span>
    </button>
  );
}

function groupTasksByProject(projects: AgentProject[], tasks: AgentTask[]): ProjectThreadGroupModel[] {
  const groups = new Map<string, ProjectThreadGroupModel>();

  for (const project of projects) {
    groups.set(project.id, { ...project, tasks: [] });
  }

  for (const task of tasks) {
    const project = task.project ?? { id: "agent-desk", name: "agent-desk" };
    const group = groups.get(project.id);
    if (group) {
      group.tasks.push(task);
    } else {
      groups.set(project.id, { ...project, tasks: [task] });
    }
  }

  return Array.from(groups.values());
}

function ensureProjectsFromTasks(projects: AgentProject[], tasks: AgentTask[]) {
  const byId = new Map<string, AgentProject>();

  for (const project of projects) {
    byId.set(project.id, project);
  }

  for (const task of tasks) {
    const project = task.project ?? { id: "agent-desk", name: "agent-desk" };
    byId.set(project.id, project);
  }

  if (!byId.has("agent-desk")) {
    byId.set("agent-desk", { id: "agent-desk", name: "agent-desk" });
  }

  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function ChatHeader({
  eventCount,
  isEventPanelOpen,
  status,
  title,
  summary,
  onToggleEvents,
}: {
  eventCount: number;
  isEventPanelOpen: boolean;
  status: TaskStatus;
  title: string;
  summary: string;
  onToggleEvents: () => void;
}) {
  return (
    <header className="flex min-h-[57px] items-center justify-between gap-5 border-b border-[#eceeef] bg-white px-6 py-2 max-[860px]:flex-col max-[860px]:items-stretch max-[860px]:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <NotebookTabs className="shrink-0 text-[#303638]" size={20} />
        <h1 className="truncate text-[17px] font-semibold">AgentDesk</h1>
        <button className="grid size-8 place-items-center rounded-md text-[#9aa0a2] hover:bg-[#f1f3f3]" type="button">
          <MoreHorizontal size={20} />
        </button>
      </div>
      <div className="flex items-center gap-3">
        <button
          className={`flex min-h-9 items-center gap-2 rounded-xl px-3 text-sm font-medium transition ${
            isEventPanelOpen ? "bg-[#e5e9e9] text-[#202124]" : "text-[#596063] hover:bg-[#f1f3f3]"
          }`}
          type="button"
          onClick={onToggleEvents}
        >
          <DatabaseZap size={16} />
          事件
          <span className="rounded-full bg-white/70 px-1.5 text-xs text-[#7f8588]">{eventCount}</span>
        </button>
        <div className="flex min-w-52 items-center gap-2 rounded-lg px-2 py-1 max-[860px]:min-w-0">
          <StatusIcon status={status} />
          <div className="min-w-0">
            <strong className="block truncate text-xs font-semibold text-[#596063]">{title}</strong>
            <small className="block truncate text-xs text-[#9aa0a2]">{summary}</small>
          </div>
        </div>
      </div>
    </header>
  );
}

function EventDebugPanel({
  events,
  isOpen,
  onClose,
}: {
  events: TaskEvent[];
  isOpen: boolean;
  onClose: () => void;
}) {
  const summaries = useMemo(() => summarizeTaskEvents(events), [events]);

  if (!isOpen) {
    return null;
  }

  return (
    <aside className="absolute bottom-0 right-0 top-[57px] z-20 grid w-[420px] grid-rows-[auto_minmax(0,1fr)] border-l border-[#e1e4e5] bg-white shadow-[-16px_0_40px_rgba(32,33,36,0.08)] max-[860px]:left-0 max-[860px]:top-72 max-[860px]:w-auto">
      <header className="flex min-h-14 items-center justify-between border-b border-[#eceeef] px-4">
        <div>
          <h2 className="text-sm font-semibold text-[#202124]">OpenCode 原始事件</h2>
          <p className="text-xs text-[#9aa0a2]">用于判断事件是否真的进入前端。</p>
        </div>
        <button
          className="rounded-lg px-2 py-1 text-sm font-medium text-[#596063] hover:bg-[#f1f3f3]"
          type="button"
          onClick={onClose}
        >
          关闭
        </button>
      </header>
      <div className="min-h-0 overflow-auto p-3">
        {summaries.length === 0 ? (
          <p className="rounded-xl border border-[#e1e4e5] bg-[#f7f8f8] px-3 py-3 text-sm text-[#7f8588]">暂无事件。</p>
        ) : (
          <div className="grid gap-2">
            {summaries.map((event, index) => (
              <details className="rounded-xl border border-[#e1e4e5] bg-[#f7f8f8]" key={event.id ?? `${event.title}-${index}`}>
                <summary className="cursor-pointer list-none px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-semibold text-[#303638]">{event.title}</span>
                    <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs text-[#7f8588]">{event.status}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#9aa0a2]">
                    <span>{formatMessageTime(new Date(event.timestamp))}</span>
                    {event.messageId ? <span>{event.messageId}</span> : null}
                  </div>
                </summary>
                <pre className="max-h-96 overflow-auto border-t border-[#e1e4e5] px-3 py-2 text-xs leading-5 text-[#303638]">
                  {event.rawText || "无内容"}
                </pre>
              </details>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

const TranscriptMessagesContext = createContext<TranscriptMessage[]>([]);

function useTranscriptMessages() {
  return useContext(TranscriptMessagesContext);
}

function AgentChat({
  activeProject,
  disabled,
  messages,
  onSend,
  projects,
  status,
  onSelectProject,
}: {
  activeProject: AgentProject;
  disabled: boolean;
  messages: TranscriptMessage[];
  onSend: (value: string) => Promise<void>;
  projects: AgentProject[];
  status: TaskStatus;
  onSelectProject: (project: AgentProject) => void;
}) {
  const assistantMessages = useMemo(() => toAssistantUiMessages(messages), [messages]);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const isEmpty = messages.length === 0;
  const messageSignature = useMemo(() => messages.map(messageScrollSignature).join("|"), [messages]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const scrollToBottom = () => {
      if (!shouldStickToBottomRef.current) {
        return;
      }
      viewport.scrollTop = viewport.scrollHeight;
    };

    const firstFrame = window.requestAnimationFrame(() => {
      scrollToBottom();
      window.requestAnimationFrame(scrollToBottom);
    });

    return () => window.cancelAnimationFrame(firstFrame);
  }, [messageSignature, status]);

  useEffect(() => {
    const content = contentRef.current;
    const viewport = viewportRef.current;
    if (!content || !viewport) {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (!shouldStickToBottomRef.current) {
        return;
      }
      window.requestAnimationFrame(() => {
        viewport.scrollTop = viewport.scrollHeight;
      });
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  function handleViewportScroll() {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const distanceToBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    shouldStickToBottomRef.current = distanceToBottom < 160;
  }

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
          <ThreadPrimitive.Viewport
            ref={viewportRef}
            className="h-full overflow-y-auto overflow-x-hidden"
            onScroll={handleViewportScroll}
          >
            <div ref={contentRef} className="mx-auto flex min-h-full max-w-5xl flex-col gap-9 px-10 py-8 pb-28 max-[860px]:px-5">
              {isEmpty ? <EmptyChatWelcome activeProject={activeProject} projects={projects} onSelectProject={onSelectProject} /> : null}
              <TranscriptMessagesContext.Provider value={messages}>
                <ThreadPrimitive.Messages>{() => <AssistantUiMessage />}</ThreadPrimitive.Messages>
              </TranscriptMessagesContext.Provider>
            </div>
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
        <AssistantUiComposer
          activeProject={activeProject}
          disabled={disabled}
          isDraft={isEmpty}
          isRunning={status === "running" || status === "queued"}
          projects={projects}
          onSelectProject={onSelectProject}
        />
      </div>
    </AssistantRuntimeProvider>
  );
}

function messageScrollSignature(message: TranscriptMessage) {
  return [
    message.id,
    message.role,
    message.runSummary?.status ?? "",
    message.runSummary?.actions.length ?? 0,
    message.parts.map(partScrollSignature).join(","),
  ].join(":");
}

function partScrollSignature(part: MessagePart) {
  switch (part.type) {
    case "text":
    case "assistant_text":
    case "reasoning":
      return `${part.type}:${part.text.length}`;
    case "tool":
      return `${part.type}:${part.id ?? part.tool}:${part.status ?? ""}:${stringLength(part.output)}`;
    case "file":
      return `${part.type}:${part.file}`;
    case "permission":
      return `${part.type}:${part.title}`;
    case "error":
      return `${part.type}:${part.message}`;
    case "session_status":
      return `${part.type}:${part.label}:${stringLength(part.raw)}`;
    case "raw_json":
      return `${part.type}:${part.label}:${stringLength(part.raw)}`;
    default:
      return `${part.type}:${stringLength(part)}`;
  }
}

function stringLength(value: unknown) {
  if (value === undefined || value === null) {
    return 0;
  }
  if (typeof value === "string") {
    return value.length;
  }
  return JSON.stringify(value).length;
}
function EmptyChatWelcome({
  activeProject,
  projects,
  onSelectProject,
}: {
  activeProject: AgentProject;
  projects: AgentProject[];
  onSelectProject: (project: AgentProject) => void;
}) {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center py-16 text-center">
      <div className="w-full max-w-3xl">
        <h2 className="text-[34px] font-normal tracking-tight text-[#202124] max-[860px]:text-[26px]">
          我们应该在
          <ProjectPicker
            activeProject={activeProject}
            projects={projects}
            triggerClassName="mx-1 rounded-xl px-2 py-1 transition hover:bg-[#f1f3f3]"
            triggerKind="title"
            onSelectProject={onSelectProject}
          />
          中做些什么？
        </h2>
      </div>
    </div>
  );
}

function ProjectPicker({
  activeProject,
  projects,
  triggerClassName,
  triggerKind = "chip",
  onSelectProject,
}: {
  activeProject: AgentProject;
  projects: AgentProject[];
  triggerClassName?: string;
  triggerKind?: "title" | "chip";
  onSelectProject: (project: AgentProject) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filteredProjects = projects.filter((project) => project.name.toLowerCase().includes(query.trim().toLowerCase()));

  function selectProject(project: AgentProject) {
    onSelectProject(project);
    setIsOpen(false);
    setQuery("");
  }

  return (
    <span className="relative inline-block text-left">
      <button
        className={triggerClassName ?? "flex min-h-10 items-center gap-2 rounded-2xl px-3 text-[16px] text-[#303638] transition hover:bg-[#eceff0]"}
        type="button"
        onClick={() => setIsOpen((open) => !open)}
      >
        {triggerKind === "chip" ? <NotebookTabs className="shrink-0 text-[#7f8588]" size={17} strokeWidth={1.8} /> : null}
        <span>{activeProject.name}</span>
      </button>
      {isOpen ? (
        <div className="absolute left-0 top-full z-40 mt-3 w-[330px] rounded-2xl border border-[#d8dddd] bg-white p-2 text-left shadow-[0_18px_60px_rgba(32,33,36,0.18)]">
          <div className="mb-2 flex min-h-10 items-center gap-2 px-3 text-[#8d9496]">
            <Search size={18} />
            <input
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[#9aa0a2]"
              placeholder="搜索项目"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="grid gap-0.5">
            {filteredProjects.map((project) => {
              const isSelected = project.id === activeProject.id;
              const itemClassName = [
                "grid min-h-10 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 text-[16px] transition",
                isSelected ? "text-[#202124]" : "text-[#3f4648] hover:bg-[#f3f4f4]",
              ].join(" ");

              return (
                <button className={itemClassName} key={project.id} type="button" onClick={() => selectProject(project)}>
                  <NotebookTabs className="shrink-0 text-[#596063]" size={17} strokeWidth={1.8} />
                  <span className="truncate">{project.name}</span>
                  {isSelected ? <Check size={17} /> : <span className="size-[17px]" />}
                </button>
              );
            })}
            {filteredProjects.length === 0 ? <p className="px-3 py-2 text-[15px] text-[#8d9496]">没有匹配项目</p> : null}
          </div>
          <div className="mt-2 border-t border-[#edf0f0] pt-2">
            <button className="grid min-h-10 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 text-[16px] text-[#303638] transition hover:bg-[#f3f4f4]" type="button">
              <Plus size={18} />
              <span>New project</span>
              <ChevronRight className="text-[#9aa0a2]" size={17} />
            </button>
            <button className="grid min-h-10 w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-xl px-3 text-[16px] text-[#303638] transition hover:bg-[#f3f4f4]" type="button" onClick={() => setIsOpen(false)}>
              <X size={18} />
              <span>不使用项目</span>
            </button>
          </div>
        </div>
      ) : null}
    </span>
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
  const messages = useTranscriptMessages();
  return (
    <article className="group flex flex-row-reverse gap-4">
      <div className="flex min-w-0 flex-1 justify-end">
        <div className="w-fit max-w-[78%]">
          <div className="grid gap-3 rounded-2xl bg-[#f1f2f2] px-5 py-3 text-[#202124]">
            <MessagePrimitive.Parts components={{ Text: UserTextPart }} />
          </div>
          <MessageActions className="justify-end" messages={messages} />
        </div>
      </div>
    </article>
  );
}

function AssistantMessage() {
  const messages = useTranscriptMessages();
  const messageId = useAuiState((state) => state.message.id);
  const message = messages.find((item) => item.id === messageId);
  const isRunning = message?.runSummary?.status === "running" || message?.runSummary?.status === "queued";
  const hasProcess = hasIntermediateProcess(message);
  const [isProcessExpanded, setIsProcessExpanded] = useState(false);
  const showIntermediateProcess = isIntermediateProcessVisible(isRunning, isProcessExpanded);

  useEffect(() => {
    if (isRunning) {
      setIsProcessExpanded(false);
    }
  }, [isRunning, messageId]);

  return (
    <article className="group flex gap-4">
      <div className="min-w-0 flex-1">
        <div className="grid gap-3">
          <ProcessingStatusLine
            hasIntermediateProcess={hasProcess}
            isExpanded={showIntermediateProcess}
            isRunning={isRunning}
            onToggle={() => setIsProcessExpanded((open) => !open)}
            summary={message?.runSummary}
          />
          {!isRunning && showIntermediateProcess ? <IntermediateProcessDetails message={message} /> : null}
          <AssistantGroupedParts showIntermediateProcess={isRunning} />
          <MessageActions messages={messages} />
        </div>
      </div>
    </article>
  );
}

function AssistantGroupedParts({ showIntermediateProcess }: { showIntermediateProcess: boolean }) {
  const messageStatus = useAuiState((state) => state.message.status?.type);
  return (
    <MessagePrimitive.GroupedParts
      groupBy={groupPartByType({
        reasoning: ["group-chainOfThought", "group-reasoning"],
        "tool-call": ["group-chainOfThought", "group-tool"],
        "standalone-tool-call": [],
      })}
    >
      {({ part, children }) => {
        switch (part.type) {
          case "group-chainOfThought":
            return showIntermediateProcess ? <div className="grid gap-3">{children}</div> : null;
          case "group-reasoning":
            return null;
          case "group-tool":
            if (!showIntermediateProcess) {
              return null;
            }
            return (
              <ToolGroupRoot variant="ghost" defaultOpen={messageStatus === "running"}>
                <ToolGroupTrigger count={part.indices.length} active={part.status.type === "running"} />
                <ToolGroupContent>{children}</ToolGroupContent>
              </ToolGroupRoot>
            );
          case "text":
            return <MarkdownText />;
          case "reasoning":
            return null;
          case "tool-call":
            return part.toolUI ?? <ToolFallback {...part} />;
          case "indicator":
            return <ThinkingIndicator />;
          default:
            return null;
        }
      }}
    </MessagePrimitive.GroupedParts>
  );
}

function IntermediateProcessDetails({ message }: { message: TranscriptMessage | undefined }) {
  if (!message) {
    return null;
  }

  const visibleParts = intermediatePartEntries(message).filter(({ part }) => shouldRenderIntermediatePart(part));
  if (!visibleParts.length) {
    return null;
  }

  return (
    <div className="grid gap-2">
      {visibleParts.map(({ part, index }) => (
        <IntermediateProcessPart key={`${part.type}-${index}`} part={part} />
      ))}
    </div>
  );
}

function IntermediateProcessPart({ part }: { part: MessagePart }) {
  if (part.type === "text" || part.type === "assistant_text") {
    return (
      <div className="aui-md max-w-full text-[16px] leading-8 text-[#202124]">
        <p className="aui-md-p my-3 whitespace-pre-wrap leading-relaxed first:mt-0 last:mb-0">{part.text}</p>
      </div>
    );
  }

  const model = intermediateProcessModel(part);
  if (!model) {
    return null;
  }

  return (
    <ToolFallbackRoot>
      <ToolFallbackTrigger toolName={model.label} status={{ type: "complete" }} />
      <ToolFallbackContent>
        <ToolFallbackArgs argsText={model.argsText} />
        <ToolFallbackResult result={model.result} />
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
}
function intermediateProcessModel(part: MessagePart) {
  if (part.type === "tool") {
    return { label: part.tool, argsText: formatToolValue(part.input), result: part.output };
  }

  if (part.type === "file") {
    return { label: "file.edited", argsText: formatToolValue({ file: part.file }), result: part.raw };
  }

  if (part.type === "permission") {
    return { label: "permission.request", argsText: formatToolValue({ title: part.title }), result: part.raw };
  }

  if (part.type === "error") {
    return { label: "opencode.error", argsText: "", result: { message: part.message } };
  }

  if (part.type === "raw_json") {
    return { label: part.label, argsText: "", result: part.raw };
  }

  if (part.type === "raw_event") {
    return { label: part.event.rawType ?? part.event.type, argsText: "", result: part.event.raw ?? part.event };
  }

  return null;
}
function formatToolValue(value: unknown) {
  if (value === undefined) {
    return "";
  }
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
function ProcessingStatusLine({
  hasIntermediateProcess,
  isExpanded,
  isRunning,
  onToggle,
  summary,
}: {
  hasIntermediateProcess: boolean;
  isExpanded: boolean;
  isRunning: boolean;
  onToggle: () => void;
  summary: TranscriptMessage["runSummary"] | undefined;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  if (!summary) {
    return null;
  }

  const elapsed = formatRunElapsed(summary, now);
  const label = isRunning ? "正在处理" : summary.status === "failed" ? "处理失败" : "已处理";

  return (
    <div className="flex min-h-7 items-center gap-2 text-[15px] font-medium text-[#7f8588]">
      <span>{label}</span>
      {elapsed ? <span>{elapsed}</span> : null}
      {!isRunning && hasIntermediateProcess ? (
        <button
          aria-expanded={isExpanded}
          className="grid size-6 place-items-center rounded-md transition hover:bg-[#f1f2f2] hover:text-[#303638]"
          type="button"
          onClick={onToggle}
        >
          <ChevronRight className={isExpanded ? "rotate-90 transition" : "transition"} size={16} />
        </button>
      ) : null}
    </div>
  );
}


function MessageActions({ className = "", messages }: { className?: string; messages: TranscriptMessage[] }) {
  const messageId = useAuiState((state) => state.message.id);
  const [copied, setCopied] = useState(false);
  const message = messages.find((item) => item.id === messageId);
  const canCopy = Boolean(message && transcriptMessageToCopyText(message));

  async function copyMessage() {
    if (!message) {
      return;
    }

    const text = transcriptMessageToCopyText(message);
    if (!text) {
      return;
    }

    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  if (!canCopy) {
    return null;
  }

  return (
    <div className={`flex opacity-0 transition group-hover:opacity-100 focus-within:opacity-100 ${className}`}>
      <button
        className="flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-[#7f8588] transition hover:bg-[#f1f2f2] hover:text-[#202124]"
        type="button"
        onClick={copyMessage}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? "已复制" : "复制"}
      </button>
    </div>
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
  return (
    <ReasoningRoot streaming variant="ghost">
      <ReasoningTrigger active label="正在思考" />
    </ReasoningRoot>
  );
}
function UserTextPart() {
  const part = useMessagePartText();
  return <p className="whitespace-pre-wrap text-[16px] font-normal leading-8 text-[#202124]">{part.text}</p>;
}

function AssistantUiComposer({
  activeProject,
  disabled,
  isDraft,
  isRunning,
  projects,
  onSelectProject,
}: {
  activeProject: AgentProject;
  disabled: boolean;
  isDraft: boolean;
  isRunning: boolean;
  projects: AgentProject[];
  onSelectProject: (project: AgentProject) => void;
}) {
  return (
    <footer className="bg-white px-8 py-4 max-[860px]:px-5">
      <ComposerPrimitive.Root className="mx-auto max-w-5xl rounded-3xl border border-[#e1e4e5] bg-white p-3 shadow-[0_16px_45px_rgba(32,33,36,0.08)] focus-within:border-[#c8cdcf]">
        <ComposerPrimitive.Input
          className="min-h-20 w-full resize-none bg-transparent px-2 py-2 text-[15px] leading-7 outline-none"
          placeholder="要求后续变更"
        />
        <div className="flex items-center justify-between gap-3 border-t border-[#f0f1f1] pt-3">
          {isDraft ? (
            <ProjectPicker activeProject={activeProject} projects={projects} onSelectProject={onSelectProject} />
          ) : (
            <span className="text-xs text-[#9aa0a2]">{isRunning ? "OpenCode 正在处理" : "Enter 发送，Shift + Enter 换行"}</span>
          )}
          <ComposerPrimitive.Send
            className="flex min-h-9 items-center gap-2 rounded-xl bg-[#202124] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#303134] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
          >
            {isRunning ? <Loader2 className="animate-spin" size={16} /> : <SendHorizontal size={16} />}
            {isRunning ? "处理中" : "发送"}
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
