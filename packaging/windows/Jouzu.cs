using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class Jouzu {
    static readonly string Root = AppDomain.CurrentDomain.BaseDirectory;
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = Int32.MaxValue };
    static string Pointer { get { return Path.Combine(Root, "current.json"); } }
    static Dictionary<string, object> ReadJson(string path) { return (Dictionary<string, object>)Json.DeserializeObject(File.ReadAllText(path, Encoding.UTF8)); }
    static string Text(Dictionary<string, object> value, string key) { return value.ContainsKey(key) ? Convert.ToString(value[key]) : ""; }
    static string Digest(string path) { using (var file = File.OpenRead(path)) using (var hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(file)).Replace("-", "").ToLowerInvariant(); }
    static string LongPath(string path) {
        if (path.StartsWith(@"\\?\")) return path;
        return path.StartsWith(@"\\") ? @"\\?\UNC\" + path.Substring(2) : @"\\?\" + path;
    }
    static void RegularPath(string path, HashSet<string> checkedPaths) {
        for (var item = new FileInfo(path); item != null; item = item.Directory == null ? null : new FileInfo(item.Directory.FullName)) {
            if (!checkedPaths.Add(item.FullName)) break;
            if ((File.GetAttributes(item.FullName) & FileAttributes.ReparsePoint) != 0) throw new Exception("Linked files are not allowed in the program image: " + path);
            if (String.Equals(item.FullName.TrimEnd('\\'), LongPath(Root).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase)) break;
        }
    }
    static IEnumerable<string> PayloadFiles(string directory, HashSet<string> checkedPaths) {
        RegularPath(directory, checkedPaths);
        foreach (string file in Directory.EnumerateFiles(directory)) yield return file;
        foreach (string child in Directory.EnumerateDirectories(directory))
            foreach (string file in PayloadFiles(child, checkedPaths)) yield return file;
    }
    static string VersionPath(string id) {
        if (!Regex.IsMatch(id, "^[0-9][a-z0-9.-]{0,99}$") || id.Contains("..")) throw new Exception("Invalid installed version identifier.");
        return Path.Combine(Root, "versions", id);
    }
    static string Verify(string id, bool full = true) {
        string directory = LongPath(VersionPath(id)), manifest = Path.Combine(directory, "manifest.json");
        var checkedPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        RegularPath(manifest, checkedPaths);
        var data = ReadJson(manifest);
        if (Text(data, "releaseId") != id) throw new Exception("The installed version manifest differs.");
        if (Text(data, "signing") != "unsigned-development") throw new Exception("This preview launcher requires an unsigned development image.");
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (Dictionary<string, object> entry in (object[])data["files"]) {
            string relative = Text(entry, "path");
            if (relative.Length == 0 || relative.Contains("\\") || relative.Contains(":") || relative.Split('/').Any(p => p == ".." || p == "." || p.Length == 0) || !seen.Add(relative)) throw new Exception("Invalid program manifest path.");
            string file = Path.Combine(directory, relative.Replace('/', Path.DirectorySeparatorChar));
            if (!full && relative != "node/node.exe" && relative != "bootstrap.mjs" && relative != "app/node_modules/jouzu/dist/cli.js") continue;
            RegularPath(file, checkedPaths);
            if (Digest(file) != Text(entry, "sha256")) throw new Exception("Jouzu needs repair. A program file differs: " + relative);
        }
        if (full) foreach (string file in PayloadFiles(directory, checkedPaths)) {
            RegularPath(file, checkedPaths);
            string relative = file.Substring(directory.Length + 1).Replace('\\', '/');
            if (relative != "manifest.json" && !seen.Contains(relative)) throw new Exception("Unlisted program file: " + relative);
        }
        foreach (string required in new [] { "node/node.exe", "bootstrap.mjs", "app/node_modules/jouzu/dist/cli.js", "git/bin/bash.exe", "terminal/WindowsTerminal.exe" })
            if (!seen.Contains(required)) throw new Exception("The program manifest is missing " + required);
        return VersionPath(id);
    }
    internal static string Quote(string value) {
        var result = new StringBuilder("\""); int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { result.Append('\\', slashes * 2 + 1); result.Append(c); }
            else { result.Append('\\', slashes); result.Append(c); }
            slashes = 0;
        }
        result.Append('\\', slashes * 2); return result.Append('"').ToString();
    }
    static Process Start(string exe, IEnumerable<string> args, string cwd, bool hidden) {
        var info = new ProcessStartInfo(exe, String.Join(" ", args.Select(Quote))) { UseShellExecute = false, WorkingDirectory = cwd, CreateNoWindow = hidden };
        info.EnvironmentVariables["NODE_USE_SYSTEM_CA"] = "1";
        info.EnvironmentVariables["NODE_USE_ENV_PROXY"] = "1";
        info.EnvironmentVariables["JOUZU_NO_UPDATE"] = "1";
        return Process.Start(info);
    }
    static void Activate(string id) {
        using (var activationLock = new FileStream(Path.Combine(Root, "activation.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None)) {
            string directory = Verify(id);
            using (var probe = Start(Path.Combine(directory, "node", "node.exe"), new [] { Path.Combine(directory, "app", "node_modules", "jouzu", "dist", "cli.js"), "--version" }, directory, true)) {
                if (!probe.WaitForExit(30000)) { probe.Kill(); throw new Exception("The new runtime did not start. The active version was preserved."); }
                if (probe.ExitCode != 0) throw new Exception("The new runtime failed verification. The active version was preserved.");
            }
            string previous = File.Exists(Pointer) ? Text(ReadJson(Pointer), "current") : "";
            if (previous == id) return;
            string temporary = Pointer + "." + Guid.NewGuid().ToString("N");
            File.WriteAllText(temporary, Json.Serialize(new { current = id, previous = previous }), new UTF8Encoding(false));
            if (File.Exists(Pointer)) File.Replace(temporary, Pointer, null); else File.Move(temporary, Pointer);
        }
    }
    [STAThread]
    static int Main(string[] args) {
        // Windows 10 includes .NET 4.8, but csc defaults to legacy IO behavior.
        AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling", false);
        AppContext.SetSwitch("Switch.System.IO.BlockLongPaths", false);
        try {
            if (args.Length == 2 && args[0] == "--activate") { Activate(args[1]); return 0; }
            if (args.Length == 1 && args[0] == "--rollback") {
                string previous = Text(ReadJson(Pointer), "previous");
                if (previous.Length == 0) throw new Exception("No previous Jouzu version is retained.");
                Activate(previous);
#if GUI
                MessageBox.Show("The previous Jouzu version is ready. Open Jouzu to continue.", "Jouzu");
#endif
                return 0;
            }
            string selected = Text(ReadJson(Pointer), "current"), payload = Verify(selected, args.Length == 1 && args[0] == "--verify");
            if (args.Length == 1 && args[0] == "--verify") { Console.WriteLine("Verified " + selected); return 0; }
#if GUI
            string project;
            if (args.Length == 2 && args[0] == "--project") project = Path.GetFullPath(args[1]);
            else if (args.Length == 0) {
                Application.EnableVisualStyles();
                using (var picker = new FolderBrowserDialog { Description = "Choose a project folder for Jouzu", ShowNewFolderButton = true }) {
                    if (picker.ShowDialog() != DialogResult.OK) return 0;
                    project = picker.SelectedPath;
                }
            } else throw new Exception("Use Jouzu.exe --project <folder>, or open Jouzu without arguments to choose a folder.");
            if (!Directory.Exists(project)) throw new Exception("The project folder does not exist.");
            string terminal = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "WindowsApps", "wt.exe");
            if (!File.Exists(terminal)) terminal = Path.Combine(payload, "terminal", "WindowsTerminal.exe");
            // Windows Terminal treats semicolons as command separators. Use the
            // console host for these paths; never interpolate a shell command.
            if (project.Contains(";") || Root.Contains(";")) {
                Process.Start(new ProcessStartInfo(Path.Combine(Root, "JouzuConsole.exe")) { UseShellExecute = true, WorkingDirectory = project });
            } else {
                try { Start(terminal, new [] { "-w", "new", "new-tab", "--title", "Jouzu", "--startingDirectory", project, "--", Path.Combine(Root, "JouzuConsole.exe") }, project, false); }
                catch { Process.Start(new ProcessStartInfo(Path.Combine(Root, "JouzuConsole.exe")) { UseShellExecute = true, WorkingDirectory = project }); }
            }
            return 0;
#else
            using (var instance = new Mutex(false, "Local\\JouzuDesktop")) {
                Console.CancelKeyPress += (sender, e) => { e.Cancel = true; };
                using (var child = Start(Path.Combine(payload, "node", "node.exe"), new [] { Path.Combine(payload, "bootstrap.mjs") }.Concat(args), Environment.CurrentDirectory, false)) {
                    child.WaitForExit(); return child.ExitCode;
                }
            }
#endif
        } catch (Exception error) {
#if GUI
            MessageBox.Show(error.Message, "Jouzu", MessageBoxButtons.OK, MessageBoxIcon.Error);
#else
            Console.Error.WriteLine("Jouzu: " + (Environment.GetEnvironmentVariable("JOUZU_LAUNCHER_DEBUG") == "1" ? error.ToString() : error.Message));
#endif
            return 1;
        }
    }
}
