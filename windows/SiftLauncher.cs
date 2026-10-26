using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("SIFT")]
[assembly: AssemblyDescription("筛 SIFT — 只看你关注的人")]
[assembly: AssemblyProduct("SIFT")]
[assembly: AssemblyCompany("Jiemanosh")]
[assembly: AssemblyCopyright("MIT License © 2026 Jiemanosh")]
[assembly: AssemblyVersion("1.0.1.0")]
[assembly: AssemblyFileVersion("1.0.1.0")]

namespace SiftLauncher
{
    internal static class Program
    {
        private const string MutexName = "SiftDesktopLauncher.v1";
        private const int FirstPort = 8787;
        private const int LastPort = 8887;
        private const long LogLimit = 5 * 1024 * 1024;

        private static string homeDir;
        private static string appDir;
        private static string dataDir;
        private static string logDir;
        private static string logFile;
        private static string portFile;
        private static string pidFile;
        private static string launcherPidFile;

        private static Process server;
        private static NotifyIcon tray;
        private static Form splash;
        private static Label splashLabel;
        private static int port;
        private static bool stopping;
        private static StreamWriter logWriter;
        private static readonly object logLock = new object();

        [STAThread]
        private static void Main(string[] args)
        {
            homeDir = Environment.GetEnvironmentVariable("SIFT_HOME");
            if (string.IsNullOrEmpty(homeDir))
            {
                homeDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "SIFT");
            }
            homeDir = Path.GetFullPath(homeDir);
            appDir = Path.Combine(homeDir, "app");
            string customData = Environment.GetEnvironmentVariable("SIFT_DATA_DIR");
            dataDir = string.IsNullOrEmpty(customData)
                ? Path.Combine(homeDir, "data")
                : Path.GetFullPath(customData);
            logDir = Path.Combine(homeDir, "logs");
            logFile = Path.Combine(logDir, "sift.log");
            portFile = Path.Combine(homeDir, "port.txt");
            pidFile = Path.Combine(homeDir, "server.pid");
            launcherPidFile = Path.Combine(homeDir, "launcher.pid");

            if (HasFlag(args, "--stop"))
            {
                StopRunning();
                return;
            }

            bool created;
            using (var mutex = new Mutex(true, MutexName, out created))
            {
                if (!created)
                {
                    OpenExistingInstance();
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);

                try
                {
                    EnsureHome();
                    OpenLog();
                    ShowSplash();
                    ExtractPayload();
                    port = ChoosePort();
                    StartServer();
                    WriteRuntimeFiles();
                    SetSplashText("正在打开浏览器…");
                    OpenBrowser(Url());
                    CreateTray();
                    CloseSplash();
                    Log("SIFT 已启动 " + Url() + "（数据：" + dataDir + "）");
                    Application.Run(new ApplicationContext());
                }
                catch (Exception error)
                {
                    CloseSplash();
                    Log("启动失败：" + error);
                    if (Environment.GetEnvironmentVariable("SIFT_NO_UI") != "1")
                    {
                        MessageBox.Show(
                            "SIFT 启动失败：\n" + error.Message + "\n\n日志：" + logFile,
                            "SIFT",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Error);
                    }
                    Cleanup();
                    Environment.Exit(1);
                }
                finally
                {
                    Cleanup();
                }
            }
        }

        private static bool HasFlag(string[] args, string flag)
        {
            foreach (string arg in args)
            {
                if (string.Equals(arg, flag, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        private static string Url()
        {
            return "http://127.0.0.1:" + port + "/";
        }

        private static void EnsureHome()
        {
            Directory.CreateDirectory(homeDir);
            Directory.CreateDirectory(dataDir);
            Directory.CreateDirectory(logDir);
        }

        private static void OpenLog()
        {
            try
            {
                if (File.Exists(logFile) && new FileInfo(logFile).Length > LogLimit)
                {
                    string previous = logFile + ".1";
                    if (File.Exists(previous)) File.Delete(previous);
                    File.Move(logFile, previous);
                }
            }
            catch
            {
                // A locked or oversized log must not block startup.
            }
            FileStream stream = new FileStream(logFile, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
            logWriter = new StreamWriter(stream, new UTF8Encoding(false));
            logWriter.AutoFlush = true;
            Log("----- SIFT launcher " + Application.ProductVersion + " PID " + Process.GetCurrentProcess().Id + " -----");
        }

        private static void Log(string message)
        {
            if (logWriter == null) return;
            lock (logLock)
            {
                try
                {
                    logWriter.WriteLine(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + message);
                }
                catch
                {
                    // Logging is best effort only.
                }
            }
        }

        private static void ShowSplash()
        {
            if (Environment.GetEnvironmentVariable("SIFT_NO_UI") == "1") return;
            splash = new Form();
            splash.Text = "SIFT";
            splash.FormBorderStyle = FormBorderStyle.None;
            splash.StartPosition = FormStartPosition.CenterScreen;
            splash.ShowInTaskbar = false;
            splash.ShowIcon = false;
            splash.TopMost = true;
            splash.ClientSize = new Size(380, 132);
            splash.BackColor = Color.FromArgb(243, 238, 227);
            splash.Padding = new Padding(24, 20, 24, 20);
            splash.Paint += delegate(object sender, PaintEventArgs eventArgs)
            {
                using (Pen pen = new Pen(Color.FromArgb(191, 63, 43)))
                {
                    eventArgs.Graphics.DrawRectangle(pen, 0, 0, splash.ClientSize.Width - 1, splash.ClientSize.Height - 1);
                }
            };

            splashLabel = new Label();
            splashLabel.AutoSize = false;
            splashLabel.Dock = DockStyle.Fill;
            splashLabel.TextAlign = ContentAlignment.MiddleLeft;
            splashLabel.Font = new Font("Microsoft YaHei UI", 11F, FontStyle.Regular);
            splashLabel.ForeColor = Color.FromArgb(29, 27, 23);
            splashLabel.Text = "正在启动 SIFT…";
            splash.Controls.Add(splashLabel);

            Label mark = new Label();
            mark.AutoSize = false;
            mark.Size = new Size(42, 42);
            mark.Location = new Point(24, 20);
            mark.Text = "筛";
            mark.TextAlign = ContentAlignment.MiddleCenter;
            mark.Font = new Font("Microsoft YaHei UI", 17F, FontStyle.Bold);
            mark.BackColor = Color.FromArgb(191, 63, 43);
            mark.ForeColor = Color.White;
            splash.Controls.Add(mark);
            mark.BringToFront();

            splashLabel.Padding = new Padding(58, 0, 0, 0);
            splash.Show();
            Pump();
        }

        private static void SetSplashText(string text)
        {
            if (splashLabel == null) return;
            splashLabel.Text = text;
            Pump();
        }

        private static void CloseSplash()
        {
            if (splash == null) return;
            try
            {
                splash.Hide();
                splash.Dispose();
            }
            catch
            {
                // Ignore teardown races.
            }
            splash = null;
            splashLabel = null;
        }

        private static void Pump()
        {
            Application.DoEvents();
        }

        private static Stream OpenPayload()
        {
            Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip");
            if (stream == null) throw new InvalidOperationException("安装包损坏：找不到内嵌应用资源。");
            return stream;
        }

        private static string ReadPayloadVersion(Stream stream)
        {
            try
            {
                using (var archive = new ZipArchive(stream, ZipArchiveMode.Read, true))
                {
                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        if (string.Equals(entry.FullName, "VERSION.txt", StringComparison.OrdinalIgnoreCase))
                        {
                            using (var reader = new StreamReader(entry.Open(), Encoding.UTF8))
                            {
                                return reader.ReadToEnd().Trim();
                            }
                        }
                    }
                }
            }
            catch
            {
                // Fall back to extracting when the payload cannot be inspected.
            }
            return null;
        }

        private static void ExtractPayload()
        {
            SetSplashText("正在解压运行文件，首次启动稍慢…");
            string marker = Path.Combine(appDir, ".payload-version");
            string wanted;
            using (Stream stream = OpenPayload())
            {
                wanted = ReadPayloadVersion(stream);
            }
            if (string.IsNullOrEmpty(wanted)) wanted = Application.ProductVersion;

            if (File.Exists(marker) && File.Exists(Path.Combine(appDir, "node.exe")))
            {
                try
                {
                    if (String.Equals(File.ReadAllText(marker).Trim(), wanted, StringComparison.Ordinal))
                    {
                        Log("运行文件已是最新版本，跳过解压。");
                        return;
                    }
                }
                catch
                {
                    // Re-extract when the marker cannot be read.
                }
            }

            Log("解压运行文件：" + wanted);
            if (Directory.Exists(appDir))
            {
                try
                {
                    Directory.Delete(appDir, true);
                }
                catch (Exception error)
                {
                    throw new IOException("无法更新程序文件，可能还有旧进程在运行。请退出托盘中的 SIFT 后重试。", error);
                }
            }
            Directory.CreateDirectory(appDir);

            using (Stream stream = OpenPayload())
            using (var archive = new ZipArchive(stream, ZipArchiveMode.Read))
            {
                string root = Path.GetFullPath(appDir) + Path.DirectorySeparatorChar;
                int count = 0;
                foreach (ZipArchiveEntry entry in archive.Entries)
                {
                    string relative = entry.FullName.Replace('\\', '/');
                    string target = Path.GetFullPath(Path.Combine(appDir, relative.Replace('/', Path.DirectorySeparatorChar)));
                    if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue;
                    if (relative.EndsWith("/"))
                    {
                        Directory.CreateDirectory(target);
                        continue;
                    }
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    entry.ExtractToFile(target, true);
                    count++;
                    if ((count % 150) == 0) Pump();
                }
            }
            File.WriteAllText(marker, wanted, new UTF8Encoding(false));
            if (!File.Exists(Path.Combine(appDir, "node.exe")))
            {
                throw new FileNotFoundException("运行文件不完整：缺少 node.exe。");
            }
        }

        private static int ChoosePort()
        {
            int wanted;
            string requested = Environment.GetEnvironmentVariable("SIFT_PORT");
            if (int.TryParse(requested, out wanted) && wanted > 0 && wanted < 65536)
            {
                if (IsFree(wanted)) return wanted;
                Log("SIFT_PORT " + wanted + " 被占用，改用自动端口。");
            }
            for (int candidate = FirstPort; candidate <= LastPort; candidate++)
            {
                if (IsFree(candidate)) return candidate;
            }
            throw new InvalidOperationException("找不到可用的本地端口（8787–8887 均被占用）。");
        }

        private static bool IsFree(int candidate)
        {
            TcpListener listener = null;
            try
            {
                listener = new TcpListener(IPAddress.Any, candidate);
                // Windows lets a non-exclusive 0.0.0.0 bind coexist with a
                // 127.0.0.1 listener, which would send loopback traffic to the
                // other program. SO_EXCLUSIVEADDRUSE makes the probe honest.
                listener.ExclusiveAddressUse = true;
                listener.Start();
                return true;
            }
            catch (SocketException)
            {
                return false;
            }
            finally
            {
                if (listener != null)
                {
                    try { listener.Stop(); } catch { }
                }
            }
        }

        private static void StartServer()
        {
            SetSplashText("正在启动本地服务…");
            string node = Path.Combine(appDir, "node.exe");
            if (!File.Exists(node)) throw new FileNotFoundException("缺少 node.exe。");

            ProcessStartInfo info = new ProcessStartInfo();
            info.FileName = node;
            info.Arguments = "--dns-result-order=ipv4first server/index.js";
            info.WorkingDirectory = appDir;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            info.StandardOutputEncoding = new UTF8Encoding(false);
            info.StandardErrorEncoding = new UTF8Encoding(false);
            info.EnvironmentVariables["SIFT_DATA_DIR"] = dataDir;
            info.EnvironmentVariables["SIFT_PORT"] = port.ToString();
            info.EnvironmentVariables["SIFT_HOST"] = "0.0.0.0";
            info.EnvironmentVariables["SIFT_ORIGIN"] = "http://127.0.0.1:" + port;

            server = new Process();
            server.StartInfo = info;
            server.OutputDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs)
            {
                if (eventArgs.Data != null) Log("[node] " + eventArgs.Data);
            };
            server.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs)
            {
                if (eventArgs.Data != null) Log("[node:err] " + eventArgs.Data);
            };
            if (!server.Start()) throw new InvalidOperationException("无法启动 node.exe。");
            server.BeginOutputReadLine();
            server.BeginErrorReadLine();
            Log("node 进程 PID " + server.Id + "，端口 " + port);

            if (!WaitForHealth())
            {
                string tail = ReadLogTail();
                StopServer();
                throw new InvalidOperationException(
                    "本地服务没有在预期时间内就绪。" + (string.IsNullOrEmpty(tail) ? "" : "\n\n" + tail));
            }
        }

        private static bool WaitForHealth()
        {
            string url = "http://127.0.0.1:" + port + "/api/health";
            for (int attempt = 0; attempt < 90; attempt++)
            {
                if (server != null && server.HasExited) return false;
                try
                {
                    HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
                    request.Method = "GET";
                    request.Proxy = null;
                    request.Timeout = 1500;
                    request.ReadWriteTimeout = 1500;
                    using (WebResponse response = request.GetResponse())
                    using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                    {
                        string body = reader.ReadToEnd();
                        if (body.IndexOf("\"name\":\"sift\"", StringComparison.Ordinal) >= 0) return true;
                    }
                }
                catch
                {
                    // The server is still starting up.
                }
                Thread.Sleep(250);
            }
            return false;
        }

        private static string ReadLogTail()
        {
            try
            {
                using (var stream = new FileStream(logFile, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                using (var reader = new StreamReader(stream, Encoding.UTF8))
                {
                    string text = reader.ReadToEnd();
                    if (text.Length > 1200) text = text.Substring(text.Length - 1200);
                    return text.Trim();
                }
            }
            catch
            {
                return "";
            }
        }

        private static void WriteRuntimeFiles()
        {
            File.WriteAllText(portFile, port.ToString(), new UTF8Encoding(false));
            File.WriteAllText(pidFile, server.Id.ToString(), new UTF8Encoding(false));
            File.WriteAllText(launcherPidFile, Process.GetCurrentProcess().Id.ToString(), new UTF8Encoding(false));
        }

        private static void CreateTray()
        {
            if (Environment.GetEnvironmentVariable("SIFT_NO_UI") == "1") return;
            Icon icon = null;
            try
            {
                icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            }
            catch
            {
                icon = null;
            }
            if (icon == null) icon = SystemIcons.Application;

            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add("打开 SIFT", null, delegate { OpenBrowser(Url()); });
            menu.Items.Add("打开数据文件夹", null, delegate { OpenPath(dataDir); });
            menu.Items.Add("打开日志", null, delegate { OpenPath(logFile); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出", null, delegate { ExitApp(); });

            tray = new NotifyIcon();
            tray.Icon = icon;
            tray.Text = "SIFT · 只看你关注的人";
            tray.ContextMenuStrip = menu;
            tray.Visible = true;
            tray.DoubleClick += delegate { OpenBrowser(Url()); };
            tray.ShowBalloonTip(3500, "SIFT 已启动", "右键托盘图标可以打开页面、查看数据或退出。", ToolTipIcon.Info);
        }

        private static void OpenBrowser(string url)
        {
            if (Environment.GetEnvironmentVariable("SIFT_NO_BROWSER") == "1") return;
            try
            {
                ProcessStartInfo info = new ProcessStartInfo(url);
                info.UseShellExecute = true;
                Process.Start(info);
            }
            catch (Exception error)
            {
                Log("打开浏览器失败：" + error.Message);
            }
        }

        private static void OpenPath(string path)
        {
            try
            {
                Process.Start("explorer.exe", "\"" + path + "\"");
            }
            catch (Exception error)
            {
                Log("打开路径失败：" + error.Message);
            }
        }

        private static void OpenExistingInstance()
        {
            int existingPort = 0;
            for (int attempt = 0; attempt < 24; attempt++)
            {
                try
                {
                    if (File.Exists(portFile))
                    {
                        int parsed;
                        if (int.TryParse(File.ReadAllText(portFile).Trim(), out parsed) && parsed > 0)
                        {
                            existingPort = parsed;
                            break;
                        }
                    }
                }
                catch
                {
                    // The first instance is still writing its runtime files.
                }
                Thread.Sleep(250);
            }
            if (existingPort > 0)
            {
                OpenBrowser("http://127.0.0.1:" + existingPort + "/");
                return;
            }
            if (Environment.GetEnvironmentVariable("SIFT_NO_UI") != "1")
            {
                MessageBox.Show("SIFT 已在启动中，请稍等片刻再试。", "SIFT", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }

        private static void StopRunning()
        {
            bool stopped = KillPidFile(pidFile, "node");
            stopped = KillPidFile(launcherPidFile, "sift") || stopped;
            TryDelete(portFile);
            TryDelete(pidFile);
            TryDelete(launcherPidFile);
            if (Environment.GetEnvironmentVariable("SIFT_NO_UI") != "1")
            {
                MessageBox.Show(stopped ? "SIFT 已停止。" : "SIFT 当前没有在运行。", "SIFT",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }

        private static bool KillPidFile(string file, string expectedName)
        {
            try
            {
                if (!File.Exists(file)) return false;
                int pid;
                if (!int.TryParse(File.ReadAllText(file).Trim(), out pid) || pid <= 0) return false;

                // A stale pid file plus a recycled PID must never kill an
                // unrelated program, so verify the process name first.
                Process target = Process.GetProcessById(pid);
                if (!target.ProcessName.StartsWith(expectedName, StringComparison.OrdinalIgnoreCase)) return false;

                ProcessStartInfo info = new ProcessStartInfo("taskkill", "/PID " + pid + " /T /F");
                info.UseShellExecute = false;
                info.CreateNoWindow = true;
                info.WindowStyle = ProcessWindowStyle.Hidden;
                Process killer = Process.Start(info);
                if (killer != null) killer.WaitForExit(5000);
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static void TryDelete(string file)
        {
            try
            {
                if (File.Exists(file)) File.Delete(file);
            }
            catch
            {
                // Runtime files are disposable.
            }
        }

        private static void ExitApp()
        {
            stopping = true;
            StopServer();
            if (tray != null)
            {
                tray.Visible = false;
                tray.Dispose();
                tray = null;
            }
            Application.Exit();
        }

        private static void StopServer()
        {
            if (server == null) return;
            try
            {
                if (!server.HasExited)
                {
                    KillPidFile(pidFile, "node");
                    if (!server.WaitForExit(4000))
                    {
                        try { server.Kill(); } catch { }
                        server.WaitForExit(2000);
                    }
                }
            }
            catch
            {
                // The process may have already exited.
            }
            server = null;
        }

        private static void Cleanup()
        {
            CloseSplash();
            if (!stopping) StopServer();
            if (tray != null)
            {
                try
                {
                    tray.Visible = false;
                    tray.Dispose();
                }
                catch
                {
                }
                tray = null;
            }
            TryDelete(portFile);
            TryDelete(pidFile);
            TryDelete(launcherPidFile);
            if (logWriter != null)
            {
                Log("SIFT 已退出。");
                try { logWriter.Dispose(); } catch { }
                logWriter = null;
            }
        }
    }
}
