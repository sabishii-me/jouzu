export const locales = { en: "English", ja: "日本語", "zh-Hans": "简体中文", "zh-Hant": "繁體中文" };
export type Locale = keyof typeof locales;
const en = {
  home: "Folders", settings: "Settings", general: "General", versions: "Versions & updates", development: "Development",
  heading: "Where will you work?", intro: "Open a folder to start or return to your work.", open: "Open folder…", search: "Find a recent folder…",
  loading: "Loading your folders…", preview: "Browser preview. Use the desktop app to open folders.", empty: "Start with a folder", emptyHint: "Choose an existing project or any folder you want to work in. It will appear here next time.", noResults: "No folders match your search.", remove: "Remove from recents — files are kept", removed: "Removed from recent folders. Your files were not changed.", requested: "Launch requested. Jouzu opens in a separate terminal.", dismiss: "Dismiss", retry: "Retry", error: "Something went wrong", details: "Technical details",
  preparing: "Preparing required tools…", launching: "Opening Jouzu…", choosing: "Choose a folder in the dialog.", saving: "Saving…", connecting: "Connecting to launcher…", repair: "Application files are missing. Repair the installation to continue.", safe: "Your project files stay in their original folders.", download: "Jouzu needs Git tools. Download the verified official Git for Windows package now?", prepare: "Prepare tools", picker: "Open a working folder",
  language: "Interface language", languageHint: "Changes the launcher interface, not your model or Japanese-support profile.", versionsHint: "The desktop launcher and Jouzu are separate components.", launcher: "Launcher", unavailable: "Unavailable", noUpdates: "In-app updates are not available in this build. No update check has been performed.", devHint: "This is a development build, not the installed release.", tools: "Command tools", available: "Available", firstUse: "Prepared when needed", back: "Back to folders", count: "Recent folders", clear: "Clear search", preferences: "Make the launcher work for you.", refresh: "Refresh status"
};
type Messages = typeof en;
const ja: Messages = {
 home: "フォルダー", settings: "設定", general: "一般", versions: "バージョンと更新", development: "開発版",
 heading: "どこで作業しますか？", intro: "フォルダーを開いて、作業を開始・再開できます。", open: "フォルダーを開く…", search: "最近使ったフォルダーを検索…",
 loading: "フォルダーを読み込み中…", preview: "ブラウザープレビューです。フォルダーはデスクトップアプリで開いてください。", empty: "フォルダーから始めましょう", emptyHint: "既存のプロジェクトや作業用フォルダーを選択すると、次回ここに表示されます。", noResults: "一致するフォルダーはありません。", remove: "履歴から削除 — ファイルは保持されます", removed: "履歴から削除しました。ファイルは変更されていません。", requested: "起動を要求しました。Jouzu は別のターミナルで開きます。", dismiss: "閉じる", retry: "再試行", error: "問題が発生しました", details: "技術情報",
 preparing: "必要なツールを準備中…", launching: "Jouzu を起動中…", choosing: "ダイアログでフォルダーを選択してください。", saving: "保存中…", connecting: "ランチャーに接続中…", repair: "アプリのファイルが見つかりません。インストールを修復してください。", safe: "プロジェクトのファイルは元の場所に保持されます。", download: "Git ツールが必要です。検証済みの公式 Git for Windows をダウンロードしますか？", prepare: "ツールの準備", picker: "作業用フォルダーを開く",
 language: "表示言語", languageHint: "ランチャーの表示言語を変更します。モデルや日本語サポートの設定は変更しません。", versionsHint: "ランチャーと Jouzu は別々のコンポーネントです。", launcher: "ランチャー", unavailable: "取得できません", noUpdates: "このビルドではアプリ内更新を利用できません。更新の確認は行っていません。", devHint: "これは開発版です。インストール済みのリリース版ではありません。", tools: "コマンドツール", available: "利用可能", firstUse: "必要に応じて準備", back: "フォルダーに戻る", count: "最近使ったフォルダー", clear: "検索をクリア", preferences: "ランチャーを使いやすく設定しましょう。", refresh: "状態を更新"
};
const hans: Messages = {
 home: "文件夹", settings: "设置", general: "通用", versions: "版本与更新", development: "开发版",
 heading: "从哪里开始工作？", intro: "打开文件夹，开始或继续你的工作。", open: "打开文件夹…", search: "搜索最近的文件夹…",
 loading: "正在读取文件夹…", preview: "浏览器预览。请使用桌面应用打开文件夹。", empty: "从一个文件夹开始", emptyHint: "选择现有项目或工作文件夹，下次可以在这里直接打开。", noResults: "没有匹配的文件夹。", remove: "从最近记录中移除，不删除文件", removed: "已移除记录，项目文件未更改。", requested: "已请求启动，Jouzu 将在独立终端中打开。", dismiss: "关闭提示", retry: "重试", error: "操作未完成", details: "技术详情",
 preparing: "正在准备必要工具…", launching: "正在打开 Jouzu…", choosing: "请在对话框中选择文件夹。", saving: "正在保存…", connecting: "正在连接启动器…", repair: "应用文件缺失，请修复安装后继续。", safe: "项目文件始终保留在原来的位置。", download: "Jouzu 需要 Git 工具。现在下载经过校验的官方 Git for Windows 吗？", prepare: "准备工具", picker: "打开工作文件夹",
 language: "界面语言", languageHint: "仅更改启动器界面，不更改模型或日语支持配置。", versionsHint: "启动器与 Jouzu 是独立的组件。", launcher: "启动器", unavailable: "不可用", noUpdates: "当前构建尚不支持应用内更新，未执行更新检查。", devHint: "这是开发构建，不是已安装的发行版。", tools: "命令工具", available: "可用", firstUse: "需要时准备", back: "返回文件夹", count: "最近的文件夹", clear: "清除搜索", preferences: "按你的习惯设置启动器。", refresh: "刷新状态"
};
const hant: Messages = {
 home: "資料夾", settings: "設定", general: "一般", versions: "版本與更新", development: "開發版",
 heading: "從哪裡開始工作？", intro: "開啟資料夾，開始或繼續你的工作。", open: "開啟資料夾…", search: "搜尋最近的資料夾…",
 loading: "正在讀取資料夾…", preview: "瀏覽器預覽。請使用桌面應用程式開啟資料夾。", empty: "從一個資料夾開始", emptyHint: "選擇現有專案或工作資料夾，下次可以在這裡直接開啟。", noResults: "沒有符合的資料夾。", remove: "從最近記錄中移除，不刪除檔案", removed: "已移除記錄，專案檔案未變更。", requested: "已要求啟動，Jouzu 將在獨立終端機中開啟。", dismiss: "關閉提示", retry: "重試", error: "操作未完成", details: "技術詳情",
 preparing: "正在準備必要工具…", launching: "正在開啟 Jouzu…", choosing: "請在對話框中選擇資料夾。", saving: "正在儲存…", connecting: "正在連接啟動器…", repair: "應用程式檔案遺失，請修復安裝後繼續。", safe: "專案檔案始終保留在原來的位置。", download: "Jouzu 需要 Git 工具。現在下載經過驗證的官方 Git for Windows 嗎？", prepare: "準備工具", picker: "開啟工作資料夾",
 language: "介面語言", languageHint: "僅變更啟動器介面，不變更模型或日語支援設定。", versionsHint: "啟動器與 Jouzu 是獨立的元件。", launcher: "啟動器", unavailable: "無法取得", noUpdates: "目前版本尚不支援應用程式內更新，未執行更新檢查。", devHint: "這是開發版本，不是已安裝的發行版。", tools: "命令工具", available: "可用", firstUse: "需要時準備", back: "返回資料夾", count: "最近的資料夾", clear: "清除搜尋", preferences: "依照你的習慣設定啟動器。", refresh: "重新整理狀態"
};
export const messages: Record<Locale, Messages> = { en, ja, "zh-Hans": hans, "zh-Hant": hant };
export function resolveLocale(value: string | null): Locale {
 if (value && value in locales) return value as Locale;
 const language = (value ?? "en").toLowerCase();
 if (language.startsWith("ja")) return "ja";
 if (/^zh.*(hant|tw|hk|mo)/.test(language)) return "zh-Hant";
 if (language.startsWith("zh")) return "zh-Hans";
 return "en";
}
