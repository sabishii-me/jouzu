export const locales = { en: "English", ja: "日本語", "zh-Hans": "简体中文", "zh-Hant": "繁體中文" };
export type Locale = keyof typeof locales;
const en = {
updateAvailable: "Update available", upToDate: "Up to date", updateCheckHint: "Check for a new launcher version.", updaterUnconfigured: "Launcher update source and signing key are not configured.", installingUpdate: "Installing…", downloadingUpdate: "Downloading…", checkUpdates: "Check for updates", installUpdate: "Update launcher", restartUpdateHint: "The launcher will close for installation. Save your work before continuing.", jouzuUpdatePending: "Jouzu updates: the qualified pnpm release source is not configured.",
 profileOffHint: "When disabled, no Japanese-first instructions are added. Reply language follows the conversation and other settings.",
searchProviders: "Search services", credentialSaved: "Key saved", checkConnection: "Check", checking: "Checking…", checkReachable: "Model endpoint reachable", checkAuthFailed: "Authentication rejected", checkNetworkFailed: "Network failed", checkServerFailed: "Service error", checkUnsupported: "Check unsupported", checkMissing: "Credential required", checkHint: "Check requests the model list; it does not generate text or verify every model.",
 editValue: "Edit",
connectionType: "Connection type", presetService: "Preset service", service: "Service", chooseService: "Choose a service", editConnection: "Configure provider",
 waitingAuthorization: "Waiting for browser authorization",
 openBrowser: "Open in browser",
 configuredNoKey: "Configured · no saved key",
sort: "Sort folders", sortAdded: "Added order", sortName: "Folder name", sortPath: "Full path", shisaHint: "Connect Shisa to use its coding models. Authorize this device in your browser.", shisaConnected: "Connected to Shisa.", signOutUnconfirmed: "Signed out on this device. The remote session could not be confirmed closed; check the Shisa dashboard.", connections: "Other providers", savedNotTested: "Saved · not tested", addConnection: "Add provider", backConnections: "Back to providers",
 cancel: "Cancel",
customProvider: "Custom provider", customHint: "OpenAI-compatible chat API. Text only; 32K context, 4K output. API key is optional for services that do not require authentication.", providerId: "Provider ID", endpoint: "API base URL", modelId: "Model ID",
environment: "Environment", envHint: "Applies to new sessions from this launcher. Removing an override restores inherited values.", variableName: "Name", variableValue: "Value", enabled: "Enabled", deleteEntry: "Remove entry", addEntry: "Add variable",
signIn: "Sign in to Shisa", signOut: "Sign out", loginUrl: "Sign-in URL", deviceCode: "Device code", loginHint: "Open this URL in your browser and enter the code. Waiting up to 3 minutes.",
providers: "Model providers", apiKey: "API key", save: "Save", removeCredential: "Remove saved key", defaultModel: "Default model", launch: "Open Jouzu here", dropHint: "Drop folders here",
 addFolder: "Add folder",
minimize: "Minimize", maximize: "Maximize or restore", closeWindow: "Close launcher", profile: "Japanese-first mode", profileHint: "When enabled, Jouzu defaults to Japanese explanations and reports. Changing the launcher language does not turn this off. Ask explicitly in a conversation to use another language.", chooseProfile: "Choose a profile", coreProfile: "Core", jaProfile: "Japanese support", importTitle: "Existing configuration", importHint: "Import existing Pi model and authentication settings if available. An existing import decision will be respected.", importAccept: "Import if available", importDecline: "Do not import",
  home: "Folders", settings: "Settings", general: "Language", system: "System", gitBash: "Git Bash", gitBashInUse: "In use", gitBashBundled: "Jouzu's Git Bash", gitBashSystem: "Git Bash installed on this PC", gitBashMissing: "Not installed", gitBashRequired: "Jouzu needs a Git Bash to open folders.", gitBashInstall: "Install and use Jouzu's Git Bash", gitBashUseSystem: "Use this PC's Git Bash", gitBashUseBundled: "Use Jouzu's Git Bash", gitBashInstalling: "Installing Git Bash…", windowsTerminal: "Windows Terminal", terminalBundled: "Windows Terminal included with Jouzu", terminalSystem: "Windows Terminal installed on this PC", terminalMissing: "Not installed", terminalInstall: "Install Windows Terminal", terminalInstalling: "Installing Windows Terminal…", development: "Development",
  heading: "Where will you work?", intro: "Open a folder to start or return to your work.", open: "Open folder…", search: "Find a recent folder…",
  loading: "Loading your folders…", preview: "Browser preview. Use the desktop app to open folders.", empty: "Start with a folder", emptyHint: "Choose an existing project or any folder you want to work in. It will appear here next time.", noResults: "No folders match your search.", remove: "Remove from recents — files are kept", removed: "Removed from recent folders. Your files were not changed.", requested: "Launch requested. Jouzu opens in a separate terminal.", dismiss: "Dismiss", retry: "Retry", error: "Something went wrong", details: "Technical details",
  preparing: "Preparing required tools…", launching: "Opening Jouzu…", choosing: "Choose a folder in the dialog.", saving: "Saving…", connecting: "Connecting to launcher…", repair: "Application files are missing. Repair the installation to continue.", safe: "Your project files stay in their original folders.", picker: "Open a working folder",
  language: "Launcher interface language", languageHint: "Only changes launcher menus and buttons, not Jouzu’s reply language.", versionsHint: "The desktop launcher and Jouzu are separate components.", launcher: "Launcher", unavailable: "Unavailable", noUpdates: "In-app updates are not yet available.", devHint: "This is a development build, not the installed release.", tools: "Command tools", available: "Available", firstUse: "Prepared when needed", back: "Back to folders", count: "Recent folders", clear: "Clear search", preferences: "Make the launcher work for you.", refresh: "Refresh status", setupMake: "Make Jouzu yours", setupConnect: "Connect a model", setupHint: "Sign in with Shisa or connect another provider to get started.", setupPreferencesHint: "Choose your interface language and Japanese-first preference. You can change both in Settings.", setupJapaneseHint: "Prefer Japanese explanations and reports. You can request another language in a conversation.", setupContinue: "Continue", setupWorkspaces: "Return to workspaces", setupModels: "Return to model setup"
};
type Messages = typeof en;
const ja: Messages = {
updateAvailable: "更新があります", upToDate: "最新です", updateCheckHint: "ランチャーの新しいバージョンを確認します。", updaterUnconfigured: "更新先と署名鍵が未設定です。", installingUpdate: "インストール中…", downloadingUpdate: "ダウンロード中…", checkUpdates: "更新を確認", installUpdate: "ランチャーを更新", restartUpdateHint: "インストールのためランチャーを終了します。作業を保存してください。", jouzuUpdatePending: "Jouzu 更新：検証済み pnpm リリース元は未設定です。",
 profileOffHint: "無効にすると、日本語優先の指示を追加しません。応答言語は会話や他の設定に従います。",
searchProviders: "サービスを検索", credentialSaved: "キー保存済み", checkConnection: "確認", checking: "確認中…", checkReachable: "モデル一覧に接続可能", checkAuthFailed: "認証拒否", checkNetworkFailed: "通信失敗", checkServerFailed: "サービスエラー", checkUnsupported: "確認非対応", checkMissing: "認証情報が必要", checkHint: "モデル一覧への接続を確認します。生成や全モデルの検証は行いません。",
 editValue: "編集",
connectionType: "接続の種類", presetService: "プリセットサービス", service: "サービス", chooseService: "サービスを選択", editConnection: "接続を設定",
 waitingAuthorization: "ブラウザーでの認証を待っています",
 openBrowser: "ブラウザーで開く",
 configuredNoKey: "設定済み・保存キーなし",
sort: "並び順", sortAdded: "追加順", sortName: "フォルダー名", sortPath: "パス", shisaHint: "Shisa のコーディングモデルを利用します。ブラウザーでこのデバイスを認証してください。", shisaConnected: "Shisa に接続しています。", signOutUnconfirmed: "この端末ではサインアウトしました。リモートのセッション終了を確認できませんでした。Shisa ダッシュボードを確認してください。", connections: "他のプロバイダー", savedNotTested: "保存済み・未検証", addConnection: "プロバイダーを追加", backConnections: "プロバイダーに戻る",
 cancel: "キャンセル",
customProvider: "カスタムプロバイダー", customHint: "OpenAI 互換チャット API。テキストのみ、32K コンテキスト・4K 出力。認証不要のサービスでは API キーを省略できます。", providerId: "プロバイダー ID", endpoint: "API ベース URL", modelId: "モデル ID",
environment: "環境変数", envHint: "このランチャーから開く新しいセッションに適用。上書きを削除すると継承値に戻ります。", variableName: "名前", variableValue: "値", enabled: "有効", deleteEntry: "項目を削除", addEntry: "変数を追加",
signIn: "Shisa にログイン", signOut: "ログアウト", loginUrl: "ログイン URL", deviceCode: "デバイスコード", loginHint: "ブラウザーで URL を開き、コードを入力してください。最大3分間待機します。",
providers: "モデルプロバイダー", apiKey: "API キー", save: "保存", removeCredential: "保存したキーを削除", defaultModel: "既定のモデル", launch: "ここで Jouzu を開く", dropHint: "フォルダーをドロップ",
 addFolder: "フォルダーを追加",
minimize: "最小化", maximize: "最大化・元に戻す", closeWindow: "ランチャーを閉じる", profile: "日本語優先モード", profileHint: "有効にすると、Jouzu は原則として日本語で説明・報告します。ランチャーの表示言語を変えても解除されません。他の言語を使う場合は会話で明示してください。", chooseProfile: "プロファイルを選択", coreProfile: "基本", jaProfile: "日本語サポート", importTitle: "既存の設定", importHint: "既存の Pi モデル・認証設定を取り込みます。以前の選択がある場合は尊重されます。", importAccept: "設定を取り込む", importDecline: "取り込まない",
 home: "フォルダー", settings: "設定", general: "言語", system: "システム", gitBash: "Git Bash", gitBashInUse: "使用中", gitBashBundled: "Jouzu の Git Bash", gitBashSystem: "この PC にインストール済みの Git Bash", gitBashMissing: "未インストール", gitBashRequired: "フォルダーを開くには Git Bash が必要です。", gitBashInstall: "Jouzu の Git Bash をインストールして使用", gitBashUseSystem: "この PC の Git Bash を使う", gitBashUseBundled: "Jouzu の Git Bash を使う", gitBashInstalling: "Git Bash をインストール中…", windowsTerminal: "Windows Terminal", terminalBundled: "Jouzu 同梱の Windows Terminal", terminalSystem: "この PC にインストール済みの Windows Terminal", terminalMissing: "未インストール", terminalInstall: "Windows Terminal をインストール", terminalInstalling: "Windows Terminal をインストール中…", development: "開発版",
 heading: "どこで作業しますか？", intro: "フォルダーを開いて、作業を開始・再開できます。", open: "フォルダーを開く…", search: "最近使ったフォルダーを検索…",
 loading: "フォルダーを読み込み中…", preview: "ブラウザープレビューです。フォルダーはデスクトップアプリで開いてください。", empty: "フォルダーから始めましょう", emptyHint: "既存のプロジェクトや作業用フォルダーを選択すると、次回ここに表示されます。", noResults: "一致するフォルダーはありません。", remove: "履歴から削除 — ファイルは保持されます", removed: "履歴から削除しました。ファイルは変更されていません。", requested: "起動を要求しました。Jouzu は別のターミナルで開きます。", dismiss: "閉じる", retry: "再試行", error: "問題が発生しました", details: "技術情報",
 preparing: "必要なツールを準備中…", launching: "Jouzu を起動中…", choosing: "ダイアログでフォルダーを選択してください。", saving: "保存中…", connecting: "ランチャーに接続中…", repair: "アプリのファイルが見つかりません。インストールを修復してください。", safe: "プロジェクトのファイルは元の場所に保持されます。", picker: "作業用フォルダーを開く",
 language: "ランチャーの表示言語", languageHint: "ランチャーのメニューとボタンだけを変更します。Jouzu の応答言語は変更しません。", versionsHint: "ランチャーと Jouzu は別々のコンポーネントです。", launcher: "ランチャー", unavailable: "取得できません", noUpdates: "アプリ内更新は準備中です。", devHint: "これは開発版です。インストール済みのリリース版ではありません。", tools: "コマンドツール", available: "利用可能", firstUse: "必要に応じて準備", back: "フォルダーに戻る", count: "最近使ったフォルダー", clear: "検索をクリア", preferences: "ランチャーを使いやすく設定しましょう。", refresh: "状態を更新", setupMake: "Jouzu の初期設定", setupConnect: "モデルに接続", setupHint: "Shisa にログインするか、他のサービスに接続して始めましょう。", setupPreferencesHint: "表示言語と日本語優先の設定を選びます。後から設定で変更できます。", setupJapaneseHint: "説明やレポートでは日本語を優先します。会話中に別の言語を指定できます。", setupContinue: "次へ", setupWorkspaces: "ワークスペースに戻る", setupModels: "モデル設定に戻る"
};
const hans: Messages = {
updateAvailable: "发现更新", upToDate: "已是最新", updateCheckHint: "检查启动器新版本。", updaterUnconfigured: "尚未配置启动器更新源与签名公钥。", installingUpdate: "正在安装…", downloadingUpdate: "正在下载…", checkUpdates: "检查更新", installUpdate: "更新启动器", restartUpdateHint: "安装时会关闭启动器。请先保存工作。", jouzuUpdatePending: "Jouzu 更新：尚未配置经过验证的 pnpm 发布源。",
 profileOffHint: "关闭后不再添加日语优先指令，回复语言由对话及其他配置决定，不会自动固定为中文。",
searchProviders: "搜索服务", credentialSaved: "密钥已保存", checkConnection: "检查连接", checking: "检查中…", checkReachable: "模型端点可访问", checkAuthFailed: "认证被拒绝", checkNetworkFailed: "网络连接失败", checkServerFailed: "服务端错误", checkUnsupported: "不支持此检查", checkMissing: "需要凭据", checkHint: "检查会请求模型列表，不生成内容，也不代表所有模型均可调用。",
 editValue: "编辑",
connectionType: "连接类型", presetService: "预设服务", service: "服务", chooseService: "选择服务", editConnection: "配置连接",
 waitingAuthorization: "等待浏览器授权",
 openBrowser: "在浏览器中打开",
 configuredNoKey: "已配置 · 未保存密钥",
sort: "排序", sortAdded: "添加顺序", sortName: "文件夹名称", sortPath: "完整路径", shisaHint: "连接 Shisa 使用编程模型，在浏览器中授权此设备。", shisaConnected: "已连接 Shisa。", signOutUnconfirmed: "已在此设备退出登录。无法确认远程会话已关闭，请在 Shisa 控制台确认。", connections: "其他模型服务", savedNotTested: "已保存 · 未验证", addConnection: "添加服务", backConnections: "返回服务列表",
 cancel: "取消",
customProvider: "自定义提供商", customHint: "OpenAI 兼容聊天 API。仅文本，32K 上下文、4K 输出。免认证服务可留空 API 密钥。", providerId: "提供商 ID", endpoint: "API 基础地址", modelId: "模型 ID",
environment: "环境变量", envHint: "仅用于此启动器打开的新会话。删除覆盖项后恢复继承值。", variableName: "变量名", variableValue: "值", enabled: "启用", deleteEntry: "移除条目", addEntry: "添加变量",
signIn: "登录 Shisa", signOut: "退出登录", loginUrl: "登录地址", deviceCode: "设备码", loginHint: "在浏览器打开此地址并输入设备码，最多等待 3 分钟。",
providers: "模型提供商", apiKey: "API 密钥", save: "保存", removeCredential: "移除已保存密钥", defaultModel: "默认模型", launch: "在此打开 Jouzu", dropHint: "拖入文件夹",
 addFolder: "添加文件夹",
minimize: "最小化", maximize: "最大化或还原", closeWindow: "关闭启动器", profile: "日语优先模式", profileHint: "开启后，Jouzu 默认使用日语解释和汇报。切换启动器语言不会关闭此模式；需要其他语言时，请在对话中明确要求。", chooseProfile: "选择配置", coreProfile: "基础配置", jaProfile: "日语支持", importTitle: "已有配置", importHint: "导入已有 Pi 模型与认证设置（如果存在）。已有的导入决定不会被覆盖。", importAccept: "导入已有设置", importDecline: "不导入",
 home: "文件夹", settings: "设置", general: "语言", system: "系统", gitBash: "Git Bash", gitBashInUse: "正在使用", gitBashBundled: "Jouzu 的 Git Bash", gitBashSystem: "本机安装的 Git Bash", gitBashMissing: "未安装", gitBashRequired: "打开文件夹需要 Git Bash。", gitBashInstall: "安装并使用 Jouzu 的 Git Bash", gitBashUseSystem: "使用本机的 Git Bash", gitBashUseBundled: "使用 Jouzu 的 Git Bash", gitBashInstalling: "正在安装 Git Bash…", windowsTerminal: "Windows Terminal", terminalBundled: "Jouzu 自带的 Windows Terminal", terminalSystem: "本机安装的 Windows Terminal", terminalMissing: "未安装", terminalInstall: "安装 Windows Terminal", terminalInstalling: "正在安装 Windows Terminal…", development: "开发版",
 heading: "从哪里开始工作？", intro: "打开文件夹，开始或继续你的工作。", open: "打开文件夹…", search: "搜索最近的文件夹…",
 loading: "正在读取文件夹…", preview: "浏览器预览。请使用桌面应用打开文件夹。", empty: "从一个文件夹开始", emptyHint: "选择现有项目或工作文件夹，下次可以在这里直接打开。", noResults: "没有匹配的文件夹。", remove: "从最近记录中移除，不删除文件", removed: "已移除记录，项目文件未更改。", requested: "已请求启动，Jouzu 将在独立终端中打开。", dismiss: "关闭提示", retry: "重试", error: "操作未完成", details: "技术详情",
 preparing: "正在准备必要工具…", launching: "正在打开 Jouzu…", choosing: "请在对话框中选择文件夹。", saving: "正在保存…", connecting: "正在连接启动器…", repair: "应用文件缺失，请修复安装后继续。", safe: "项目文件始终保留在原来的位置。", picker: "打开工作文件夹",
 language: "启动器界面语言", languageHint: "仅影响启动器菜单和按钮，不决定 Jouzu 的回复语言。", versionsHint: "启动器与 Jouzu 是独立的组件。", launcher: "启动器", unavailable: "不可用", noUpdates: "应用内更新暂不可用。", devHint: "这是开发构建，不是已安装的发行版。", tools: "命令工具", available: "可用", firstUse: "需要时准备", back: "返回文件夹", count: "最近的文件夹", clear: "清除搜索", preferences: "按你的习惯设置启动器。", refresh: "刷新状态", setupMake: "按你的习惯设置 Jouzu", setupConnect: "连接模型", setupHint: "登录 Shisa，或连接其他服务，即可开始使用。", setupPreferencesHint: "选择界面语言和日文优先偏好，之后可随时在设置中修改。", setupJapaneseHint: "优先使用日语解释和汇报。你仍可在对话中要求使用其他语言。", setupContinue: "继续", setupWorkspaces: "返回工作区", setupModels: "返回模型设置"
};
const hant: Messages = {
updateAvailable: "發現更新", upToDate: "已是最新", updateCheckHint: "檢查啟動器新版本。", updaterUnconfigured: "尚未設定啟動器更新來源與簽章公鑰。", installingUpdate: "正在安裝…", downloadingUpdate: "正在下載…", checkUpdates: "檢查更新", installUpdate: "更新啟動器", restartUpdateHint: "安裝時會關閉啟動器。請先儲存工作。", jouzuUpdatePending: "Jouzu 更新：尚未設定經過驗證的 pnpm 發行來源。",
 profileOffHint: "關閉後不再加入日語優先指令，回覆語言由對話及其他設定決定，不會自動固定為中文。",
searchProviders: "搜尋服務", credentialSaved: "金鑰已儲存", checkConnection: "檢查連接", checking: "檢查中…", checkReachable: "模型端點可存取", checkAuthFailed: "驗證被拒絕", checkNetworkFailed: "網路連接失敗", checkServerFailed: "伺服器錯誤", checkUnsupported: "不支援此檢查", checkMissing: "需要憑證", checkHint: "檢查會請求模型清單，不產生內容，也不代表所有模型皆可呼叫。",
 editValue: "編輯",
connectionType: "連接類型", presetService: "預設服務", service: "服務", chooseService: "選擇服務", editConnection: "設定連接",
 waitingAuthorization: "等待瀏覽器授權",
 openBrowser: "在瀏覽器中開啟",
 configuredNoKey: "已設定 · 未儲存金鑰",
sort: "排序", sortAdded: "新增順序", sortName: "資料夾名稱", sortPath: "完整路徑", shisaHint: "連接 Shisa 使用程式模型，在瀏覽器中授權此裝置。", shisaConnected: "已連接 Shisa。", signOutUnconfirmed: "已在此裝置登出。無法確認遠端工作階段已關閉，請在 Shisa 主控台確認。", connections: "其他模型服務", savedNotTested: "已儲存 · 未驗證", addConnection: "新增服務", backConnections: "返回服務清單",
 cancel: "取消",
customProvider: "自訂供應商", customHint: "OpenAI 相容聊天 API。僅文字，32K 上下文、4K 輸出。免驗證服務可不填 API 金鑰。", providerId: "供應商 ID", endpoint: "API 基底網址", modelId: "模型 ID",
environment: "環境變數", envHint: "僅用於此啟動器開啟的新工作階段。刪除覆寫項目後恢復繼承值。", variableName: "變數名稱", variableValue: "值", enabled: "啟用", deleteEntry: "移除項目", addEntry: "新增變數",
signIn: "登入 Shisa", signOut: "登出", loginUrl: "登入網址", deviceCode: "裝置碼", loginHint: "在瀏覽器開啟此網址並輸入裝置碼，最多等候 3 分鐘。",
providers: "模型供應商", apiKey: "API 金鑰", save: "儲存", removeCredential: "移除已儲存金鑰", defaultModel: "預設模型", launch: "在此開啟 Jouzu", dropHint: "拖入資料夾",
 addFolder: "新增資料夾",
minimize: "最小化", maximize: "最大化或還原", closeWindow: "關閉啟動器", profile: "日語優先模式", profileHint: "開啟後，Jouzu 預設使用日語解釋和報告。切換啟動器語言不會關閉此模式；需要其他語言時，請在對話中明確要求。", chooseProfile: "選擇設定", coreProfile: "基本設定", jaProfile: "日語支援", importTitle: "既有設定", importHint: "匯入既有 Pi 模型與驗證設定（如果存在）。不覆寫既有的匯入決定。", importAccept: "匯入既有設定", importDecline: "不匯入",
 home: "資料夾", settings: "設定", general: "語言", system: "系統", gitBash: "Git Bash", gitBashInUse: "正在使用", gitBashBundled: "Jouzu 的 Git Bash", gitBashSystem: "本機安裝的 Git Bash", gitBashMissing: "未安裝", gitBashRequired: "開啟資料夾需要 Git Bash。", gitBashInstall: "安裝並使用 Jouzu 的 Git Bash", gitBashUseSystem: "使用本機的 Git Bash", gitBashUseBundled: "使用 Jouzu 的 Git Bash", gitBashInstalling: "正在安裝 Git Bash…", windowsTerminal: "Windows Terminal", terminalBundled: "Jouzu 自帶的 Windows Terminal", terminalSystem: "本機安裝的 Windows Terminal", terminalMissing: "未安裝", terminalInstall: "安裝 Windows Terminal", terminalInstalling: "正在安裝 Windows Terminal…", development: "開發版",
 heading: "從哪裡開始工作？", intro: "開啟資料夾，開始或繼續你的工作。", open: "開啟資料夾…", search: "搜尋最近的資料夾…",
 loading: "正在讀取資料夾…", preview: "瀏覽器預覽。請使用桌面應用程式開啟資料夾。", empty: "從一個資料夾開始", emptyHint: "選擇現有專案或工作資料夾，下次可以在這裡直接開啟。", noResults: "沒有符合的資料夾。", remove: "從最近記錄中移除，不刪除檔案", removed: "已移除記錄，專案檔案未變更。", requested: "已要求啟動，Jouzu 將在獨立終端機中開啟。", dismiss: "關閉提示", retry: "重試", error: "操作未完成", details: "技術詳情",
 preparing: "正在準備必要工具…", launching: "正在開啟 Jouzu…", choosing: "請在對話框中選擇資料夾。", saving: "正在儲存…", connecting: "正在連接啟動器…", repair: "應用程式檔案遺失，請修復安裝後繼續。", safe: "專案檔案始終保留在原來的位置。", picker: "開啟工作資料夾",
 language: "啟動器介面語言", languageHint: "僅影響啟動器選單和按鈕，不決定 Jouzu 的回覆語言。", versionsHint: "啟動器與 Jouzu 是獨立的元件。", launcher: "啟動器", unavailable: "無法取得", noUpdates: "應用程式內更新暫不可用。", devHint: "這是開發版本，不是已安裝的發行版。", tools: "命令工具", available: "可用", firstUse: "需要時準備", back: "返回資料夾", count: "最近的資料夾", clear: "清除搜尋", preferences: "依照你的習慣設定啟動器。", refresh: "重新整理狀態", setupMake: "依照你的習慣設定 Jouzu", setupConnect: "連接模型", setupHint: "登入 Shisa，或連接其他服務，即可開始使用。", setupPreferencesHint: "選擇介面語言和日文優先偏好，之後可隨時在設定中修改。", setupJapaneseHint: "優先使用日語說明和彙報。你仍可在對話中要求使用其他語言。", setupContinue: "繼續", setupWorkspaces: "返回工作區", setupModels: "返回模型設定"
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
