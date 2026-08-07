import contextlib
import io
import json
import subprocess
import sys
import time


TIME_LIMIT_SECONDS = 2
MAX_ERROR_MESSAGE_LENGTH = 1000
MAX_STDIO_OUTPUT_LENGTH = 4000


def judge_submission(code, function_name, test_cases, judge_mode="function"):
    if judge_mode == "stdio":
        return judge_stdio_submission(code, test_cases)

    return judge_function_submission(code, function_name, test_cases)


def judge_function_submission(code, function_name, test_cases):
    start_time = time.perf_counter()

    payload = {
        "code": code,
        "function_name": function_name,
        "test_cases": [
            {
                "args": test_case.args or [],
                "kwargs": test_case.kwargs or {},
                "expected": test_case.expected,
                "hidden": test_case.hidden,
            }
            for test_case in test_cases
        ],
    }

    try:
        completed = subprocess.run(
            [sys.executable, __file__, "--worker"],
            input=json.dumps(payload),
            text=True,
            capture_output=True,
            timeout=TIME_LIMIT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        return build_result(
            "Time Limit Exceeded",
            0,
            len(test_cases),
            start_time,
            "代码执行超时",
            [],
        )

    try:
        return json.loads(completed.stdout)
    except Exception as e:
        return build_result(
            "Runtime Error",
            0,
            len(test_cases),
            start_time,
            f"Judge Error: {type(e).__name__}: {e}",
            [],
        )


def worker_main():
    payload = json.loads(sys.stdin.read())

    result = run_code(
        payload["code"],
        payload["function_name"],
        payload["test_cases"],
    )

    sys.stdout.write(json.dumps(result))


def run_code(code, function_name, test_cases):
    namespace = {}
    case_results = []
    total_cases = len(test_cases)
    passed_cases = 0
    start_time = time.perf_counter()

    try:
        with contextlib.redirect_stdout(io.StringIO()):
            exec(code, namespace)
    except SyntaxError as e:
        return build_result(
            "Compile Error",
            0,
            total_cases,
            start_time,
            f"{type(e).__name__}: {e}",
            [],
        )
    except Exception as e:
        return build_result(
            "Runtime Error",
            0,
            total_cases,
            start_time,
            f"{type(e).__name__}: {e}",
            [],
        )

    func = namespace.get(function_name)

    if not callable(func):
        return build_result(
            "Runtime Error",
            0,
            total_cases,
            start_time,
            f"Function '{function_name}' not found",
            [],
        )

    for index, test_case in enumerate(test_cases, start=1):
        args = test_case["args"] or []
        kwargs = test_case["kwargs"] or {}
        expected = test_case["expected"]
        hidden = test_case["hidden"]

        case_start = time.perf_counter()

        try:
            with contextlib.redirect_stdout(io.StringIO()):
                actual = func(*args, **kwargs)

            runtime_ms = int((time.perf_counter() - case_start) * 1000)

            if actual == expected:
                status = "Accepted"
                passed_cases += 1
            else:
                status = "Wrong Answer"

            result = {
                "case_index": index,
                "status": status,
                "runtime_ms": runtime_ms,
                "hidden": hidden,
                "args": args,
                "kwargs": kwargs,
                "expected": expected,
                "actual": make_json_safe(actual),
                "error_message": None,
            }

        except Exception as e:
            runtime_ms = int((time.perf_counter() - case_start) * 1000)

            result = {
                "case_index": index,
                "status": "Runtime Error",
                "runtime_ms": runtime_ms,
                "hidden": hidden,
                "args": args,
                "kwargs": kwargs,
                "expected": expected,
                "actual": None,
                "error_message": f"{type(e).__name__}: {e}",
            }

        case_results.append(result)

    if any(item["status"] == "Runtime Error" for item in case_results):
        final_status = "Runtime Error"
    elif passed_cases == total_cases:
        final_status = "Accepted"
    else:
        final_status = "Wrong Answer"

    return build_result(
        final_status,
        passed_cases,
        total_cases,
        start_time,
        None,
        case_results,
    )


def judge_stdio_submission(code, test_cases):
    start_time = time.perf_counter()
    case_results = []
    total_cases = len(test_cases)
    passed_cases = 0
    final_status = None
    final_error = None

    for index, test_case in enumerate(test_cases, start=1):
        stdin_text = get_stdio_input(test_case.args)
        expected_output = get_stdio_expected(test_case.expected)
        hidden = test_case.hidden
        case_start = time.perf_counter()

        try:
            completed = subprocess.run(
                [sys.executable, "-c", code],
                input=stdin_text,
                text=True,
                capture_output=True,
                timeout=TIME_LIMIT_SECONDS,
            )
        except subprocess.TimeoutExpired:
            runtime_ms = int((time.perf_counter() - case_start) * 1000)
            final_status = "Time Limit Exceeded"
            final_error = "代码执行超时"
            case_results.append(build_stdio_case_result(
                index,
                final_status,
                runtime_ms,
                hidden,
                stdin_text,
                expected_output,
                None,
                final_error,
            ))
            break

        runtime_ms = int((time.perf_counter() - case_start) * 1000)

        if completed.returncode != 0:
            error_message = trim_message(completed.stderr.strip() or "程序运行失败")
            final_status = "Compile Error" if "SyntaxError" in error_message else "Runtime Error"
            final_error = error_message
            case_results.append(build_stdio_case_result(
                index,
                final_status,
                runtime_ms,
                hidden,
                stdin_text,
                expected_output,
                completed.stdout,
                error_message,
            ))
            break

        actual_output = completed.stdout

        if normalize_stdio_output(actual_output) == normalize_stdio_output(expected_output):
            status = "Accepted"
            passed_cases += 1
        else:
            status = "Wrong Answer"
            final_status = status

        case_results.append(build_stdio_case_result(
            index,
            status,
            runtime_ms,
            hidden,
            stdin_text,
            expected_output,
            actual_output,
            None,
        ))

        if status != "Accepted":
            break

    if final_status is None:
        final_status = "Accepted" if passed_cases == total_cases else "Wrong Answer"

    return build_result(
        final_status,
        passed_cases,
        total_cases,
        start_time,
        final_error,
        case_results,
    )


def get_stdio_input(args):
    if args is None:
        return ""

    if isinstance(args, str):
        return args

    if isinstance(args, list):
        if not args:
            return ""
        if len(args) == 1:
            return str(args[0])
        return "\n".join(str(item) for item in args)

    return str(args)


def get_stdio_expected(expected):
    if expected is None:
        return ""
    return expected if isinstance(expected, str) else str(expected)


def normalize_stdio_output(value):
    return str(value or "").replace("\r\n", "\n").replace("\r", "\n").rstrip()


def trim_message(value):
    text = str(value or "")
    if len(text) <= MAX_ERROR_MESSAGE_LENGTH:
        return text
    return text[:MAX_ERROR_MESSAGE_LENGTH] + "\n...输出已截断"


def trim_stdio_output(value):
    text = str(value or "")
    if len(text) <= MAX_STDIO_OUTPUT_LENGTH:
        return text
    return text[:MAX_STDIO_OUTPUT_LENGTH] + "\n...输出已截断"


def build_stdio_case_result(
    index,
    status,
    runtime_ms,
    hidden,
    stdin_text,
    expected_output,
    actual_output,
    error_message,
):
    return {
        "case_index": index,
        "status": status,
        "runtime_ms": runtime_ms,
        "hidden": hidden,
        "args": stdin_text,
        "kwargs": None,
        "expected": expected_output,
        "actual": None if actual_output is None else trim_stdio_output(actual_output),
        "error_message": error_message,
    }


def make_json_safe(value):
    try:
        json.dumps(value)
        return value
    except TypeError:
        return repr(value)


def build_result(status, passed_cases, total_cases, start_time, error_message, case_results):
    runtime_ms = int((time.perf_counter() - start_time) * 1000)

    return {
        "status": status,
        "passed_cases": passed_cases,
        "total_cases": total_cases,
        "runtime_ms": runtime_ms,
        "error_message": error_message,
        "case_results": case_results,
    }


if __name__ == "__main__":
    if "--worker" in sys.argv:
        worker_main()
