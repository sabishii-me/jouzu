using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Linq;
using System.Text;
using System.Runtime.InteropServices.ComTypes;
internal static class LauncherTests {
    [DllImport("shell32.dll", SetLastError = true)] static extern IntPtr CommandLineToArgvW([MarshalAs(UnmanagedType.LPWStr)] string cmd, out int count);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
    [ComImport, Guid("00021401-0000-0000-C000-000000000046")] class ShellLink { }
    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
    interface IShellLinkW {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int count, IntPtr findData, uint flags);
    }
    static string ReadShortcut(string path) {
        object link = new ShellLink();
        try {
            ((IPersistFile)link).Load(path, 0);
            var target = new StringBuilder(32768);
            ((IShellLinkW)link).GetPath(target, target.Capacity, IntPtr.Zero, 4);
            return target.ToString();
        } finally { Marshal.FinalReleaseComObject(link); }
    }
    static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    static void FolderPreferences() {
        string root = Path.Combine(Path.GetTempPath(), "jouzu-folder-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try {
            string state = Path.Combine(root, "data", "launcher.json");
            var first = Jouzu.ReadFolderPreference(state);
            Check(!first.Remember && first.Folder == "", "First launch must require a folder and opt in to remembering");
            string folder = Path.Combine(root, "日本語 folder; & spaces");
            Directory.CreateDirectory(folder);
            Jouzu.SaveFolderPreference(state, folder, true);
            var saved = Jouzu.ReadFolderPreference(state);
            Check(saved.Remember && saved.Folder == folder && saved.Warning == "", "Remembered folder did not round trip");
            Directory.Delete(folder);
            var missing = Jouzu.ReadFolderPreference(state);
            Check(missing.Folder == folder && missing.Warning.Length > 0, "Missing folder must not fall back silently");
            string before = File.ReadAllText(state);
            bool rejected = false;
            try { Jouzu.SaveFolderPreference(state, folder, true); } catch { rejected = true; }
            Check(rejected && before == File.ReadAllText(state), "Unavailable folder overwrote preferences");
            Directory.CreateDirectory(folder);
            Jouzu.SaveFolderPreference(state, folder, false);
            Check(!Jouzu.ReadFolderPreference(state).Remember && File.ReadAllText(state).Contains("\"folder\":\"\""), "Opt out retained the folder");
            File.WriteAllText(state, "not json");
            Check(Jouzu.ReadFolderPreference(state).Warning.Length > 0, "Corrupt preference needs recovery");
            File.WriteAllText(state, "{\"schemaVersion\":1,\"remember\":true,\"folder\":\"relative\"}");
            Check(Jouzu.ReadFolderPreference(state).Folder == "", "Relative saved folder was accepted");
            File.WriteAllText(state, new string('x', 16385));
            Check(Jouzu.ReadFolderPreference(state).Warning.Length > 0, "Unbounded preference was accepted");
            Check(Directory.GetFiles(Path.GetDirectoryName(state), "*.tmp").Length == 0, "Preference write left temporary files");
        } finally { Directory.Delete(root, true); }
    }
    [STAThread]
    static int Main(string[] args) {
        if (args.Length == 3 && args[0] == "--shortcut") {
            if (!String.Equals(ReadShortcut(args[1]), args[2], StringComparison.OrdinalIgnoreCase)) throw new Exception("Windows Unicode shortcut target differs");
            Console.WriteLine("Windows Unicode shortcut target passed"); return 0;
        }
        string[] values = { "", "plain", "日本語 full width　folder", "a b", "quoted\"value", "trailing\\", "C:\\space path\\", "semi;colon", "x&y", "line\nbreak", "tab\there" };
        int count;
        IntPtr parsed = CommandLineToArgvW("fixture.exe " + String.Join(" ", values.Select(Jouzu.Quote)), out count);
        if (parsed == IntPtr.Zero) throw new Exception("Windows argument parsing failed");
        try {
            if (count != values.Length + 1) throw new Exception("Argument count differs");
            for (int i = 0; i < values.Length; i++)
                if (Marshal.PtrToStringUni(Marshal.ReadIntPtr(parsed, (i + 1) * IntPtr.Size)) != values[i]) throw new Exception("Argument changed: " + i);
        } finally { LocalFree(parsed); }
        FolderPreferences();
        Console.WriteLine("Windows launcher argument and folder preference tests passed"); return 0;
    }
}
