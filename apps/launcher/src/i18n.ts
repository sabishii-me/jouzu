export const locales = { en: "English", ja: "日本語", "zh-Hans": "简体中文", "zh-Hant": "繁體中文" };
export type Locale = keyof typeof locales;
const en = {
 openBrowser: "Open in browser",
 configuredNoKey: "Configured · no saved key",
sort: "Sort folders", sortAdded: "Added order", sortName: "Folder name", sortPath: "Full path", shisaHint: "Connect Shisa to use its coding models. Authorize this device in your browser.", credentialPresent: "Credential available locally", notConfigured: "Not connected", connections: "Connections", savedNotTested: "Saved · not tested", addConnection: "Add connection", backConnections: "Back to connections",
 cancel: "Cancel",
customProvider: "Custom provider", customHint: "OpenAI-compatible chat API. Text only; 32K context, 4K output. Add a key above after saving.", providerId: "Provider ID", endpoint: "API base URL", modelId: "Model ID",
environment: "Environment", envHint: "Applies to new sessions from this launcher. Removing an override restores inherited values.", variableName: "Name", variableValue: "Value", enabled: "Enabled", deleteEntry: "Remove entry", addEntry: "Add variable",
signIn: "Sign in to Shisa", signOut: "Sign out", loginUrl: "Sign-in URL", deviceCode: "Device code", loginHint: "Open this URL in your browser and enter the code. Waiting up to 3 minutes.",
providers: "Model providers", apiKey: "API key", save: "Save", removeCredential: "Remove saved key", defaultModel: "Default model", launch: "Open Jouzu here", dropHint: "Drop folders here",
 addFolder: "Add folder",
minimize: "Minimize", maximize: "Maximize or restore", closeWindow: "Close launcher", profile: "Japanese support", profileHint: "Optional Japanese-focused instructions and skills. Saving applies the profile for console startup too.", chooseProfile: "Choose a profile", coreProfile: "Core", jaProfile: "Japanese support", importTitle: "Existing configuration", importHint: "Import existing Pi model and authentication settings if available. An existing import decision will be respected.", importAccept: "Import if available", importDecline: "Do not import",
  home: "Folders", settings: "Settings", general: "General", versions: "Versions & updates", development: "Development",
  heading: "Where will you work?", intro: "Open a folder to start or return to your work.", open: "Open folder…", search: "Find a recent folder…",
  loading: "Loading your folders…", preview: "Browser preview. Use the desktop app to open folders.", empty: "Start with a folder", emptyHint: "Choose an existing project or any folder you want to work in. It will appear here next time.", noResults: "No folders match your search.", remove: "Remove from recents — files are kept", removed: "Removed from recent folders. Your files were not changed.", requested: "Launch requested. Jouzu opens in a separate terminal.", dismiss: "Dismiss", retry: "Retry", error: "Something went wrong", details: "Technical details",
  preparing: "Preparing required tools…", launching: "Opening Jouzu…", choosing: "Choose a folder in the dialog.", saving: "Saving…", connecting: "Connecting to launcher…", repair: "Application files are missing. Repair the installation to continue.", safe: "Your project files stay in their original folders.", download: "Jouzu needs Git tools. Download the verified official Git for Windows package now?", prepare: "Prepare tools", picker: "Open a working folder",
  language: "Interface language", languageHint: "Changes the launcher interface, not your model or Japanese-support profile.", versionsHint: "The desktop launcher and Jouzu are separate components.", launcher: "Launcher", unavailable: "Unavailable", noUpdates: "In-app updates are not yet available.", devHint: "This is a development build, not the installed release.", tools: "Command tools", available: "Available", firstUse: "Prepared when needed", back: "Back to folders", count: "Recent folders", clear: "Clear search", preferences: "Make the launcher work for you.", refresh: "Refresh status"
};
type Messages = typeof en;
const ja: Messages = {
 openBrowser: "ブラウザーで開く",
 configuredNoKey: "設定済み・保存キーなし",
sort: "並び順", sortAdded: "追加順", sortName: "フォルダー名", sortPath: "パス", shisaHint: "Shisa のコーディングモデルを利用します。ブラウザーでこのデバイスを認証してください。", credentialPresent: "認証情報あり", notConfigured: "未接続", connections: "接続先", savedNotTested: "保存済み・未検証", addConnection: "接続先を追加", backConnections: "接続先に戻る",
 cancel: "キャンセル",
customProvider: "カスタムプロバイダー", customHint: "OpenAI 互換チャット API。テキストのみ、32K コンテキスト・4K 出力。保存後に上でキーを追加。", providerId: "プロバイダー ID", endpoint: "API ベース URL", modelId: "モデル ID",
environment: "環境変数", envHint: "このランチャーから開く新しいセッションに適用。上書きを削除すると継承値に戻ります。", variableName: "名前", variableValue: "値", enabled: "有効", deleteEntry: "項目を削除", addEntry: "変数を追加",
signIn: "Shisa にログイン", signOut: "ログアウト", loginUrl: "ログイン URL", deviceCode: "デバイスコード", loginHint: "ブラウザーで URL を開き、コードを入力してください。最大3分間待機します。",
providers: "モデルプロバイダー", apiKey: "API キー", save: "保存", removeCredential: "保存したキーを削除", defaultModel: "既定のモデル", launch: "ここで Jouzu を開く", dropHint: "フォルダーをドロップ",
 addFolder: "フォルダーを追加",
minimize: "最小化", maximize: "最大化・元に戻す", closeWindow: "ランチャーを閉じる", profile: "日本語サポート", profileHint: "日本語向けの指示とスキルを追加します。保存した設定はコンソールにも適用されます。", chooseProfile: "プロファイルを選択", coreProfile: "基本", jaProfile: "日本語サポート", importTitle: "既存の設定", importHint: "既存の Pi モデル・認証設定を取り込みます。以前の選択がある場合は尊重されます。", importAccept: "設定を取り込む", importDecline: "取り込まない",
 home: "フォルダー", settings: "設定", general: "一般", versions: "バージョンと更新", development: "開発版",
 heading: "どこで作業しますか？", intro: "フォルダーを開いて、作業を開始・再開できます。", open: "フォルダーを開く…", search: "最近使ったフォルダーを検索…",
 loading: "フォルダーを読み込み中…", preview: "ブラウザープレビューです。フォルダーはデスクトップアプリで開いてください。", empty: "フォルダーから始めましょう", emptyHint: "既存のプロジェクトや作業用フォルダーを選択すると、次回ここに表示されます。", noResults: "一致するフォルダーはありません。", remove: "履歴から削除 — ファイルは保持されます", removed: "履歴から削除しました。ファイルは変更されていません。", requested: "起動を要求しました。Jouzu は別のターミナルで開きます。", dismiss: "閉じる", retry: "再試行", error: "問題が発生しました", details: "技術情報",
 preparing: "必要なツールを準備中…", launching: "Jouzu を起動中…", choosing: "ダイアログでフォルダーを選択してください。", saving: "保存中…", connecting: "ランチャーに接続中…", repair: "アプリのファイルが見つかりません。インストールを修復してください。", safe: "プロジェクトのファイルは元の場所に保持されます。", download: "Git ツールが必要です。検証済みの公式 Git for Windows をダウンロードしますか？", prepare: "ツールの準備", picker: "作業用フォルダーを開く",
 language: "表示言語", languageHint: "ランチャーの表示言語を変更します。モデルや日本語サポートの設定は変更しません。", versionsHint: "ランチャーと Jouzu は別々のコンポーネントです。", launcher: "ランチャー", unavailable: "取得できません", noUpdates: "アプリ内更新は準備中です。", devHint: "これは開発版です。インストール済みのリリース版ではありません。", tools: "コマンドツール", available: "利用可能", firstUse: "必要に応じて準備", back: "フォルダーに戻る", count: "最近使ったフォルダー", clear: "検索をクリア", preferences: "ランチャーを使いやすく設定しましょう。", refresh: "状態を更新"
};
const hans: Messages = {
 openBrowser: "在浏览器中打开",
 configuredNoKey: "已配置 · 未保存密钥",
sort: "排序", sortAdded: "添加顺序", sortName: "文件夹名称", sortPath: "完整路径", shisaHint: "连接 Shisa 使用编程模型，在浏览器中授权此设备。", credentialPresent: "本地已有凭据", notConfigured: "未连接", connections: "模型连接", savedNotTested: "已保存 · 未验证", addConnection: "添加连接", backConnections: "返回连接列表",
 cancel: "取消",
customProvider: "自定义提供商", customHint: "OpenAI 兼容聊天 API。仅文本，32K 上下文、4K 输出。保存后在上方添加密钥。", providerId: "提供商 ID", endpoint: "API 基础地址", modelId: "模型 ID",
environment: "环境变量", envHint: "仅用于此启动器打开的新会话。删除覆盖项后恢复继承值。", variableName: "变量名", variableValue: "值", enabled: "启用", deleteEntry: "移除条目", addEntry: "添加变量",
signIn: "登录 Shisa", signOut: "退出登录", loginUrl: "登录地址", deviceCode: "设备码", loginHint: "在浏览器打开此地址并输入设备码，最多等待 3 分钟。",
providers: "模型提供商", apiKey: "API 密钥", save: "保存", removeCredential: "移除已保存密钥", defaultModel: "默认模型", launch: "在此打开 Jouzu", dropHint: "拖入文件夹",
 addFolder: "添加文件夹",
minimize: "最小化", maximize: "最大化或还原", closeWindow: "关闭启动器", profile: "日语支持", profileHint: "可选的日语指令与技能。保存后也用于 console 启动，不会再次询问。", chooseProfile: "选择配置", coreProfile: "基础配置", jaProfile: "日语支持", importTitle: "已有配置", importHint: "导入已有 Pi 模型与认证设置（如果存在）。已有的导入决定不会被覆盖。", importAccept: "导入已有设置", importDecline: "不导入",
 home: "文件夹", settings: "设置", general: "通用", versions: "版本与更新", development: "开发版",
 heading: "从哪里开始工作？", intro: "打开文件夹，开始或继续你的工作。", open: "打开文件夹…", search: "搜索最近的文件夹…",
 loading: "正在读取文件夹…", preview: "浏览器预览。请使用桌面应用打开文件夹。", empty: "从一个文件夹开始", emptyHint: "选择现有项目或工作文件夹，下次可以在这里直接打开。", noResults: "没有匹配的文件夹。", remove: "从最近记录中移除，不删除文件", removed: "已移除记录，项目文件未更改。", requested: "已请求启动，Jouzu 将在独立终端中打开。", dismiss: "关闭提示", retry: "重试", error: "操作未完成", details: "技术详情",
 preparing: "正在准备必要工具…", launching: "正在打开 Jouzu…", choosing: "请在对话框中选择文件夹。", saving: "正在保存…", connecting: "正在连接启动器…", repair: "应用文件缺失，请修复安装后继续。", safe: "项目文件始终保留在原来的位置。", download: "Jouzu 需要 Git 工具。现在下载经过校验的官方 Git for Windows 吗？", prepare: "准备工具", picker: "打开工作文件夹",
 language: "界面语言", languageHint: "仅更改启动器界面，不更改模型或日语支持配置。", versionsHint: "启动器与 Jouzu 是独立的组件。", launcher: "启动器", unavailable: "不可用", noUpdates: "应用内更新暂不可用。", devHint: "这是开发构建，不是已安装的发行版。", tools: "命令工具", available: "可用", firstUse: "需要时准备", back: "返回文件夹", count: "最近的文件夹", clear: "清除搜索", preferences: "按你的习惯设置启动器。", refresh: "刷新状态"
};
const hant: Messages = {
 openBrowser: "在瀏覽器中開啟",
 configuredNoKey: "已設定 · 未儲存金鑰",
sort: "排序", sortAdded: "新增順序", sortName: "資料夾名稱", sortPath: "完整路徑", shisaHint: "連接 Shisa 使用程式模型，在瀏覽器中授權此裝置。", credentialPresent: "本機已有憑證", notConfigured: "未連接", connections: "模型連接", savedNotTested: "已儲存 · 未驗證", addConnection: "新增連接", backConnections: "返回連接清單",
 cancel: "取消",
customProvider: "自訂供應商", customHint: "OpenAI 相容聊天 API。僅文字，32K 上下文、4K 輸出。儲存後在上方新增金鑰。", providerId: "供應商 ID", endpoint: "API 基底網址", modelId: "模型 ID",
environment: "環境變數", envHint: "僅用於此啟動器開啟的新工作階段。刪除覆寫項目後恢復繼承值。", variableName: "變數名稱", variableValue: "值", enabled: "啟用", deleteEntry: "移除項目", addEntry: "新增變數",
signIn: "登入 Shisa", signOut: "登出", loginUrl: "登入網址", deviceCode: "裝置碼", loginHint: "在瀏覽器開啟此網址並輸入裝置碼，最多等候 3 分鐘。",
providers: "模型供應商", apiKey: "API 金鑰", save: "儲存", removeCredential: "移除已儲存金鑰", defaultModel: "預設模型", launch: "在此開啟 Jouzu", dropHint: "拖入資料夾",
 addFolder: "新增資料夾",
minimize: "最小化", maximize: "最大化或還原", closeWindow: "關閉啟動器", profile: "日語支援", profileHint: "可選的日語指令與技能。儲存後也用於 console 啟動，不會再次詢問。", chooseProfile: "選擇設定", coreProfile: "基本設定", jaProfile: "日語支援", importTitle: "既有設定", importHint: "匯入既有 Pi 模型與驗證設定（如果存在）。不覆寫既有的匯入決定。", importAccept: "匯入既有設定", importDecline: "不匯入",
 home: "資料夾", settings: "設定", general: "一般", versions: "版本與更新", development: "開發版",
 heading: "從哪裡開始工作？", intro: "開啟資料夾，開始或繼續你的工作。", open: "開啟資料夾…", search: "搜尋最近的資料夾…",
 loading: "正在讀取資料夾…", preview: "瀏覽器預覽。請使用桌面應用程式開啟資料夾。", empty: "從一個資料夾開始", emptyHint: "選擇現有專案或工作資料夾，下次可以在這裡直接開啟。", noResults: "沒有符合的資料夾。", remove: "從最近記錄中移除，不刪除檔案", removed: "已移除記錄，專案檔案未變更。", requested: "已要求啟動，Jouzu 將在獨立終端機中開啟。", dismiss: "關閉提示", retry: "重試", error: "操作未完成", details: "技術詳情",
 preparing: "正在準備必要工具…", launching: "正在開啟 Jouzu…", choosing: "請在對話框中選擇資料夾。", saving: "正在儲存…", connecting: "正在連接啟動器…", repair: "應用程式檔案遺失，請修復安裝後繼續。", safe: "專案檔案始終保留在原來的位置。", download: "Jouzu 需要 Git 工具。現在下載經過驗證的官方 Git for Windows 嗎？", prepare: "準備工具", picker: "開啟工作資料夾",
 language: "介面語言", languageHint: "僅變更啟動器介面，不變更模型或日語支援設定。", versionsHint: "啟動器與 Jouzu 是獨立的元件。", launcher: "啟動器", unavailable: "無法取得", noUpdates: "應用程式內更新暫不可用。", devHint: "這是開發版本，不是已安裝的發行版。", tools: "命令工具", available: "可用", firstUse: "需要時準備", back: "返回資料夾", count: "最近的資料夾", clear: "清除搜尋", preferences: "依照你的習慣設定啟動器。", refresh: "重新整理狀態"
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
