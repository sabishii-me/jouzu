using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

// Release discovery only. Installation remains owned by the Windows installer.
internal static class InstallerUpdates {
    const string Repository = "https://github.com/shisa-ai/jouzu/releases/download/";
    const string Feed = "https://api.github.com/repos/shisa-ai/jouzu/releases?per_page=100&page=";
    internal sealed class Offer {
        public string Version;
        public string Tag;
        public string Asset;
        public string Url { get { return Repository + Tag + "/" + Asset; } }
    }
    static JavaScriptSerializer Serializer() { return new JavaScriptSerializer { MaxJsonLength = 2 * 1024 * 1024 }; }
    static string Text(Dictionary<string, object> item, string key) {
        object value; return item.TryGetValue(key, out value) ? value as string ?? "" : "";
    }
    static Version ParseVersion(string value) {
        Version parsed;
        return Regex.IsMatch(value ?? "", @"\A(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\z") && Version.TryParse(value, out parsed) ? parsed : null;
    }
    internal static Offer Validate(string version, string tag, string asset) {
        if (ParseVersion(version) == null || (tag != version && tag != "v" + version)) return null;
        // Match the installer build's release ID, including its optional payload hash suffix.
        if (!Regex.IsMatch(asset ?? "", @"\AJouzuSetup-" + Regex.Escape(version) + @"(?:-[a-f0-9]{7,40})?-x64(?:-unsigned)?\.exe\z")) return null;
        return new Offer { Version = version, Tag = tag, Asset = asset };
    }
    internal static Offer Select(string json, string installedVersion, Offer best = null) {
        var installed = ParseVersion(installedVersion);
        if (installed == null) return null;
        var releases = Serializer().DeserializeObject(json) as object[];
        if (releases == null) throw new InvalidDataException("Invalid release list.");
        foreach (var item in releases) {
            var release = item as Dictionary<string, object>;
            object draft, prerelease, assets;
            if (release == null || !release.TryGetValue("draft", out draft) || !(draft is bool) || (bool)draft ||
                !release.TryGetValue("prerelease", out prerelease) || !(prerelease is bool) || (bool)prerelease ||
                !release.TryGetValue("assets", out assets) || !(assets is object[])) continue;
            string tag = Text(release, "tag_name"), version = tag.StartsWith("v") ? tag.Substring(1) : tag;
            var parsed = ParseVersion(version);
            if (parsed == null || parsed <= installed || (best != null && parsed <= ParseVersion(best.Version))) continue;
            foreach (var entry in (object[])assets) {
                var asset = entry as Dictionary<string, object>;
                if (asset == null || Text(asset, "state") != "uploaded") continue;
                var candidate = Validate(version, tag, Text(asset, "name"));
                if (candidate == null || Text(asset, "browser_download_url") != candidate.Url) continue;
                best = candidate; break;
            }
        }
        return best;
    }
    internal static string ReadBounded(Stream stream, int limit) {
        using (var buffer = new MemoryStream()) {
            var chunk = new byte[8192]; int count;
            while ((count = stream.Read(chunk, 0, chunk.Length)) > 0) {
                if (buffer.Length + count > limit) throw new InvalidDataException("Release response exceeds the size limit.");
                buffer.Write(chunk, 0, count);
            }
            return Encoding.UTF8.GetString(buffer.ToArray());
        }
    }
    internal static string Fetch(int page) {
        // The framework compiler targets legacy TLS defaults; GitHub requires TLS 1.2.
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        var request = (HttpWebRequest)WebRequest.Create(Feed + page);
        request.UserAgent = "Jouzu-Windows-Installer";
        request.Accept = "application/vnd.github+json";
        request.Headers["X-GitHub-Api-Version"] = "2022-11-28";
        request.Timeout = 5000; request.ReadWriteTimeout = 5000;
        request.AllowAutoRedirect = false;
        request.Proxy = WebRequest.DefaultWebProxy;
        // Abort also bounds a response that continuously trickles bytes.
        using (var deadline = new System.Threading.Timer(_ => request.Abort(), null, 5000, System.Threading.Timeout.Infinite))
        using (var response = (HttpWebResponse)request.GetResponse()) {
            if (response.StatusCode != HttpStatusCode.OK) throw new IOException("Release check failed.");
            using (var stream = response.GetResponseStream()) return ReadBounded(stream, 2 * 1024 * 1024);
        }
    }
    internal static Offer Check(string cachePath, string installedVersion, DateTime now, Func<int, string> fetch) {
        if (ParseVersion(installedVersion) == null) return null;
        try {
            Directory.CreateDirectory(Path.GetDirectoryName(cachePath));
            // Only one launcher checks at a time; contention never delays startup.
            using (var gate = new FileStream(cachePath + ".lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None)) {
                Offer cached = null;
                try {
                    using (var stream = File.OpenRead(cachePath)) {
                        var state = Serializer().DeserializeObject(ReadBounded(stream, 16384)) as Dictionary<string, object>;
                        DateTime checkedAt;
                        if (state != null && DateTime.TryParseExact(Text(state, "checkedAt"), "o", System.Globalization.CultureInfo.InvariantCulture,
                            System.Globalization.DateTimeStyles.RoundtripKind, out checkedAt)) {
                            cached = Validate(Text(state, "version"), Text(state, "tag"), Text(state, "asset"));
                            if (now >= checkedAt && now - checkedAt < TimeSpan.FromHours(24))
                                return cached != null && ParseVersion(cached.Version) > ParseVersion(installedVersion) ? cached : null;
                        }
                    }
                } catch { /* Missing or damaged cache can be replaced. */ }
                // Persist the attempt before networking, including offline/rate-limited attempts.
                Save(cachePath, now, null);
                Offer best = null;
                for (int page = 1; page <= 3; page++) {
                    string json = fetch(page);
                    best = Select(json, installedVersion, best);
                    if (((object[])Serializer().DeserializeObject(json)).Length < 100) break;
                }
                Save(cachePath, now, best);
                return best;
            }
        } catch { return null; }
    }
    static void Save(string path, DateTime now, Offer offer) {
        string temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try {
            File.WriteAllText(temporary, Serializer().Serialize(new { checkedAt = now.ToString("o"),
                version = offer == null ? "" : offer.Version, tag = offer == null ? "" : offer.Tag, asset = offer == null ? "" : offer.Asset }), new UTF8Encoding(false));
            if (File.Exists(path)) File.Replace(temporary, path, null); else File.Move(temporary, path);
        } finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    internal static Offer Check(string installedVersion) {
        string path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "JouzuDesktop", "installer-update.json");
        return Check(path, installedVersion, DateTime.UtcNow, Fetch);
    }
}
