import io.legado.app.help.RuleComplete
import org.json.JSONObject
fun main() {
  generateSequence(::readLine).forEach { line ->
    val v = JSONObject(line)
    val result = RuleComplete.autoComplete(v.getString("rule"), if (v.isNull("preRule")) null else v.getString("preRule"), v.getInt("type"))
    println(v.put("expected", result).toString())
  }
}
