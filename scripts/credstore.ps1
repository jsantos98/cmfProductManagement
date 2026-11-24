<#
  Windows Credential Manager helper (generic credentials, current user, encrypted by Windows).
  Used by the server to remember the Customer Portal refresh token without writing it to any file.

  credstore.ps1 get <target>     prints the secret on stdout (exit 2 when not found)
  credstore.ps1 set <target>     reads the secret from stdin (never from the command line)
  credstore.ps1 delete <target>  removes it (exit 0 also when it did not exist)
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('get', 'set', 'delete')][string]$Action,
  [Parameter(Mandatory = $true)][string]$Target
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class CmfCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredWrite(ref CREDENTIAL cred, int flags);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredDelete(string target, int type, int flags);
  [DllImport("advapi32.dll")]
  private static extern void CredFree(IntPtr cred);
  private const int GENERIC = 1, PERSIST_LOCAL_MACHINE = 2;

  public static string Read(string target) {
    IntPtr p;
    if (!CredRead(target, GENERIC, 0, out p)) return null;
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      if (c.CredentialBlobSize == 0) return "";
      byte[] b = new byte[c.CredentialBlobSize];
      Marshal.Copy(c.CredentialBlob, b, 0, b.Length);
      return Encoding.Unicode.GetString(b);
    } finally { CredFree(p); }
  }
  public static void Write(string target, string secret) {
    byte[] b = Encoding.Unicode.GetBytes(secret);
    CREDENTIAL c = new CREDENTIAL();
    c.Type = GENERIC; c.TargetName = target; c.Persist = PERSIST_LOCAL_MACHINE;
    c.UserName = Environment.UserName; c.CredentialBlobSize = b.Length;
    c.CredentialBlob = Marshal.AllocHGlobal(b.Length);
    try {
      Marshal.Copy(b, 0, c.CredentialBlob, b.Length);
      if (!CredWrite(ref c, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    } finally { Marshal.FreeHGlobal(c.CredentialBlob); }
  }
  public static void Delete(string target) { CredDelete(target, GENERIC, 0); }
}
'@

switch ($Action) {
  'get' {
    $v = [CmfCred]::Read($Target)
    if ($null -eq $v) { exit 2 }
    [Console]::Out.Write($v)
  }
  'set' {
    $secret = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrEmpty($secret)) { Write-Error 'No secret on stdin'; exit 1 }
    [CmfCred]::Write($Target, $secret.Trim())
  }
  'delete' { [CmfCred]::Delete($Target) }
}
