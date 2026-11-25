import com.suixincrazy.legado.JavaBridgeEngine;
import org.json.JSONArray;
import org.json.JSONObject;

public class JavaBridgeContractTest {
  static JavaBridgeEngine engine = new JavaBridgeEngine();
  static Object request(JSONObject value) throws Exception { value.put("session", "contract"); return engine.execute(value).get("value"); }
  static JSONObject load(String name) throws Exception { return (JSONObject)request(new JSONObject().put("operation", "class").put("name", name)); }
  static Object call(JSONObject target, String name, Object... args) throws Exception { return request(new JSONObject().put("operation", "call").put("ref", target.getInt("$java")).put("name", name).put("args", new JSONArray(args))); }
  static void expect(Object actual, Object expected) { if (!actual.equals(expected)) throw new AssertionError(actual + " != " + expected); }
  public static void main(String[] args) throws Exception {
    if (args.length > 0 && args[0].equals("serve")) {
      java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(System.in, java.nio.charset.StandardCharsets.UTF_8));
      String line;
      while ((line = reader.readLine()) != null) {
        try { System.out.println(engine.execute(new JSONObject(line)).toString()); }
        catch (Throwable error) { System.out.println(new JSONObject().put("error", error.toString()).toString()); }
      }
      return;
    }
    JSONObject jsoup = load("org.jsoup.Jsoup");
    JSONObject document = (JSONObject)call(jsoup, "parse", "<li><a href='/1'>one</a></li><li>two</li>");
    JSONArray nodes = (JSONArray)call(document, "select", "li");
    expect(nodes.length(), 2); expect(call(nodes.getJSONObject(0), "text"), "one");
    JSONObject digest = load("cn.hutool.crypto.digest.DigestUtil"); expect(call(digest, "md5Hex", "abc"), "900150983cd24fb0d6963f7d28e17f72");
    JSONObject base64 = load("java.util.Base64"); JSONObject decoder = (JSONObject)call(base64, "getDecoder");
    JSONObject bytes = (JSONObject)call(decoder, "decode", "YWJj"); expect(bytes.getJSONArray("items").toString(), "[97,98,99]");
    JSONObject arrays = load("java.util.Arrays"); expect(((JSONObject)call(arrays, "copyOfRange", bytes, 1, 3)).getJSONArray("items").toString(), "[98,99]");
    boolean blocked = false; try { load("java.lang.Runtime"); } catch (SecurityException e) { blocked = true; } expect(blocked, true);
    request(new JSONObject().put("operation", "release"));
    expect(request(new JSONObject().put("operation", "replace").put("text", "ABC abc").put("pattern", "(?i:a)bc").put("replacement", "X").put("isRegex", true)), "ABC X");
    expect(request(new JSONObject().put("operation", "replace").put("text", "ABC abc").put("pattern", "(?i)abc").put("replacement", "X").put("isRegex", true)), "X X");
    expect(request(new JSONObject().put("operation", "replace").put("text", "foo 123").put("pattern", "(\\d+)").put("replacement", "$1-$1").put("isRegex", true)), "foo 123-123");
    expect(request(new JSONObject().put("operation", "replaceMatches").put("text", "A1 B22").put("pattern", "(?i)([a-z])(\\d+)")).toString(), new JSONArray(new String[]{"A1", "B22"}).toString());
    expect(request(new JSONObject().put("operation", "replaceResults").put("text", "A1 B22").put("pattern", "(?i)([a-z])(\\d+)").put("results", new JSONArray(new String[]{"$2\\path", "[$1]"}))), "1\\path [B]");
    boolean timedOut = false;
    try { request(new JSONObject().put("operation", "replace").put("text", "a".repeat(30000) + "!").put("pattern", "(a+)+$").put("replacement", "").put("timeout", 100)); }
    catch (IllegalStateException e) { timedOut = e.getMessage().contains("timed out"); }
    expect(timedOut, true);
    System.out.println("Java bridge contracts passed: Jsoup, Hutool MD5, Base64, arrays, session isolation");
  }
}
