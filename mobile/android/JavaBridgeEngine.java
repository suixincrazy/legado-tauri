package com.suixincrazy.legado;

import org.json.JSONArray;
import org.json.JSONObject;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.Function;
import org.mozilla.javascript.NativeJavaClass;
import org.mozilla.javascript.NativeJavaPackage;
import org.mozilla.javascript.NativeJavaMethod;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.ScriptableObject;
import org.mozilla.javascript.Undefined;
import org.mozilla.javascript.Wrapper;
import java.lang.reflect.Array;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;

// Session handles retain JVM objects without exposing them to the app WebView.
public final class JavaBridgeEngine {
  private static final class Session {
    final Scriptable scope;
    final Map<Integer, Object> handles = new HashMap<>();
    int sequence;
    Session(Context cx) { scope = cx.initStandardObjects(); }
  }
  private final Map<String, Session> sessions = new HashMap<>();
  private static final class TimedText implements CharSequence {
    final String text; final long deadline;
    TimedText(String text, long deadline) { this.text = text; this.deadline = deadline; }
    void check() { if (System.nanoTime() > deadline) throw new IllegalStateException("Replacement rule timed out"); }
    public int length() { check(); return text.length(); }
    public char charAt(int index) { check(); return text.charAt(index); }
    public CharSequence subSequence(int start, int end) { check(); return new TimedText(text.substring(start, end), deadline); }
    public String toString() { check(); return text; }
  }
  private static boolean visible(String name) {
    for (String denied : new String[]{"java.lang.Class", "java.lang.Runtime", "java.lang.Process", "java.lang.System", "java.lang.reflect", "java.lang.invoke", "java.io.File", "java.io.RandomAccess", "java.nio.file", "java.net.URLClassLoader", "dalvik.", "android.content", "android.database", "android.system", "android.app", "android.webkit", "com.suixincrazy.", "app.tauri.", "org.mozilla.", "cn.hutool.core.io", "cn.hutool.core.bean", "cn.hutool.core.lang.reflect"}) if (name.startsWith(denied)) return false;
    return name.startsWith("java.") || name.startsWith("javax.crypto.") || name.startsWith("org.jsoup.") || name.startsWith("cn.hutool.") || name.startsWith("okhttp3.") || name.startsWith("okio.") || name.startsWith("com.jayway.jsonpath.") || name.startsWith("net.minidev.json.") || name.startsWith("android.os.Build") || name.startsWith("android.util.Base64");
  }
  public synchronized JSONObject execute(JSONObject request) throws Exception {
    if (request.optString("operation").equals("replace")) {
      String text = request.getString("text"), pattern = request.getString("pattern"), replacement = request.getString("replacement");
      long deadline = System.nanoTime() + Math.max(100, Math.min(30000, request.optInt("timeout", 3000))) * 1000000L;
      String result = request.optBoolean("isRegex", true) ? Pattern.compile(pattern).matcher(new TimedText(text, deadline)).replaceAll(replacement) : text.replace(pattern, replacement);
      return new JSONObject().put("value", result);
    }
    String sessionId = request.getString("session"), operation = request.getString("operation");
    if (operation.equals("release")) { sessions.remove(sessionId); return new JSONObject().put("value", JSONObject.NULL); }
    Context cx = Context.enter();
    try {
      cx.setOptimizationLevel(-1);
      cx.setClassShutter(JavaBridgeEngine::visible);
      Session session = sessions.get(sessionId);
      if (session == null) {
        if (sessions.size() >= 8) throw new IllegalStateException("Too many Java source sessions");
        session = new Session(cx); sessions.put(sessionId, session);
      }
      Object result;
      if (operation.equals("class")) {
        String name = request.getString("name");
        if (!visible(name)) throw new SecurityException("Java class unavailable: " + name);
        result = new NativeJavaClass(session.scope, Class.forName(name));
      } else {
        int ref = request.getInt("ref"); Object target = session.handles.get(ref);
        if (!(target instanceof Scriptable)) throw new IllegalArgumentException("Expired Java object");
        Scriptable object = (Scriptable) target;
        if (operation.equals("get")) result = ScriptableObject.getProperty(object, request.getString("name"));
        else if (operation.equals("string")) result = Context.toString(object);
        else {
          JSONArray values = request.optJSONArray("args"); Object[] args = new Object[values == null ? 0 : values.length()];
          for (int i = 0; i < args.length; i++) args[i] = decode(values.get(i), session, cx);
          if (operation.equals("construct")) result = ((Function) object).construct(cx, session.scope, args);
          else if (operation.equals("call")) {
            Object method = ScriptableObject.getProperty(object, request.getString("name"));
            if (!(method instanceof Function)) throw new IllegalArgumentException("Java method unavailable: " + request.getString("name"));
            result = ((Function) method).call(cx, session.scope, object, args);
          } else throw new IllegalArgumentException("Unknown Java operation");
        }
      }
      return new JSONObject().put("value", encode(result, session, cx));
    } finally { Context.exit(); }
  }
  private Object decode(Object value, Session session, Context cx) throws Exception {
    if (value == JSONObject.NULL) return null;
    if (value instanceof JSONObject) {
      JSONObject object = (JSONObject) value;
      if (object.has("$java")) return session.handles.get(object.getInt("$java"));
      Scriptable result = cx.newObject(session.scope);
      for (java.util.Iterator<String> keys = object.keys(); keys.hasNext();) { String key = keys.next(); ScriptableObject.putProperty(result, key, decode(object.get(key), session, cx)); }
      return result;
    }
    if (value instanceof JSONArray) {
      JSONArray array = (JSONArray) value; Object[] values = new Object[array.length()];
      for (int i = 0; i < values.length; i++) values[i] = decode(array.get(i), session, cx);
      return cx.newArray(session.scope, values);
    }
    return value;
  }
  private Object encode(Object value, Session session, Context cx) throws Exception {
    if (value == null || value == Undefined.instance || value == Scriptable.NOT_FOUND) return JSONObject.NULL;
    Object raw = value instanceof Wrapper ? ((Wrapper) value).unwrap() : value;
    if (raw instanceof CharSequence || raw instanceof Character) return raw.toString();
    if (raw instanceof Number || raw instanceof Boolean) return raw;
    if (raw instanceof Map) {
      JSONObject object = new JSONObject();
      for (Map.Entry<?, ?> entry : ((Map<?, ?>) raw).entrySet()) object.put(String.valueOf(entry.getKey()), encode(Context.javaToJS(entry.getValue(), session.scope), session, cx));
      int id = ++session.sequence; session.handles.put(id, value instanceof Scriptable ? value : Context.javaToJS(raw, session.scope));
      return new JSONObject().put("$java", id).put("kind", "map").put("items", object);
    }
    if (raw.getClass().isArray()) {
      JSONArray array = new JSONArray(); for (int i = 0; i < Array.getLength(raw); i++) array.put(encode(Array.get(raw, i), session, cx));
      int id = ++session.sequence; session.handles.put(id, value instanceof Scriptable ? value : Context.javaToJS(raw, session.scope));
      return new JSONObject().put("$java", id).put("kind", "array").put("items", array);
    }
    if (raw instanceof Iterable) {
      JSONArray array = new JSONArray(); for (Object item : (Iterable<?>) raw) array.put(encode(Context.javaToJS(item, session.scope), session, cx));
      if (raw.getClass().getName().startsWith("net.minidev.json.")) return new JSONObject().put("$jsonArray", array).put("text", raw.toString());
      return array;
    }
    if (!(value instanceof Scriptable)) value = Context.javaToJS(value, session.scope);
    int id = ++session.sequence; session.handles.put(id, value);
    return new JSONObject().put("$java", id).put("kind", value instanceof NativeJavaMethod ? "method" : value instanceof NativeJavaClass ? "class" : "object").put("className", value instanceof NativeJavaClass ? ((NativeJavaClass)value).getClassObject().getName() : raw.getClass().getName());
  }
}
