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
    System.out.println("Java bridge contracts passed: Jsoup, Hutool MD5, Base64, arrays, session isolation");
  }
}
