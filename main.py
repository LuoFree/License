import numpy as np
import uuid
import os
import re
import mysql.connector
from mysql.connector import Error
import gradio as gr
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, HTTPException, APIRouter, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse,FileResponse,RedirectResponse
from fastapi.staticfiles import StaticFiles
from tqdm import tqdm
import cv2
import numpy
from shutil import copy
from kenshutsu import Kenshutsu  # 导入检测类
from read_plate import ReadPlate
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont
from db_operations import (
    ensure_schema, insert_plate, get_all_plates, delete_plate, get_owner_by_plate, update_plate
)

# from logger_module import Logger
# logger = Logger('/www/wwwpython/logClass/lpd_log.txt')

# ====== 登录配置 ======
VALID_USERS = {
    "admin": "admin",
    "guest": "guest"
}

# 用字典保存 token -> username，便于显示当前登录用户
ACTIVE_TOKENS = {}  # {token: username}


def DrawChinese(img, text, positive, fontSize=20, fontColor=(255, 0, 0)):
    cv2img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    pilimg = Image.fromarray(cv2img)
    # PIL图片上打印汉字
    draw = ImageDraw.Draw(pilimg)  # 图片上打印
    font = ImageFont.truetype("MSJHL.TTC", fontSize, encoding="utf-8")  # 参数1：字体文件路径，参数2：字体大小
    draw.text(positive, text, fontColor, font=font)  # 参数1：打印坐标，参数2：文本，参数3：字体颜色，参数4：字体格式
    cv2charimg = cv2.cvtColor(numpy.array(pilimg), cv2.COLOR_RGB2BGR)  # PIL图片转cv2 图片
    return cv2charimg, text


# ========= 登录相关函数 =========
def authenticate(username, password):
    return VALID_USERS.get(username) == password


def create_token(username):
    token = str(uuid.uuid4())
    ACTIVE_TOKENS[token] = username
    return token


def logout_token(token):
    ACTIVE_TOKENS.pop(token, None)


def ensure_login(token):
    """
    检查是否已登录，未登录抛 PermissionError
    已登录则返回用户名
    """
    username = ACTIVE_TOKENS.get(token)
    if not username:
        raise PermissionError("请先登录后再操作")
    return username


# ========= 业务函数 =========
def process_image(token, input_image):
    """
    图像检测函数：现在第一个参数是 token，并在内部校验登录
    """
    try:
        username = ensure_login(token)
    except PermissionError as e:
        # 未登录时直接在右侧文字框提示
        return None, str(e), gr.Dropdown(choices=[])

    gr.Info("调用模型开始推理……")

    if input_image is None:
        return None, "请先上传图片", gr.Dropdown(choices=[])

    if len(input_image.shape) == 3 and input_image.shape[2] == 3:
        image_bgr = cv2.cvtColor(input_image, cv2.COLOR_RGB2BGR)
    else:
        image_bgr = input_image.copy()

    detecter = Kenshutsu(False)
    read_plate = ReadPlate()
    boxes = detecter(image_bgr)
    plates = []
    detected_plates = []  # 暂时没用到，但保留

    for box in boxes:
        x1, y1, x2, y2, the, c = box
        x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)
        if 2 <= int(c) <= 8:
            image_ = image_bgr[y1:y2, x1:x2]
            result = read_plate(image_)
            class_name = detecter.names[int(c)] if int(c) < len(detecter.names) else "未知车型"
            if result:
                plate, (x11, y11, x22, y22) = result[0]
                plates.append(
                    (x1, y1, x2, y2, plate,
                     x11 + x1, y11 + y1, x22 + x1, y22 + y1,
                     class_name)
                )

    if not plates:
        for plate, (x11, y11, x22, y22) in read_plate(image_bgr):
            plates.append(
                (None, None, None, None, plate,
                 int(x11), int(y11), int(x22), int(y22),
                 "未知车型")
            )

    result_image = image_bgr.copy()
    car_numbers = []
    new_car_number = ""
    result_str = ""
    index = 1

    for item in plates:
        x1, y1, x2, y2, plate_name, x11, y11, x22, y22, class_name = item
        if None not in (x1, y1, x2, y2):
            x1, y1, x2, y2 = map(int, (x1, y1, x2, y2))
            result_image = cv2.rectangle(result_image, (x1, y1), (x2, y2), (0, 255, 0), 2)

        x11, y11, x22, y22 = map(int, (x11, y11, x22, y22))
        result_image = cv2.rectangle(result_image, (x11 - 5, y11 - 5), (x22 + 5, y22 + 5), (0, 0, 255), 2)
        result_image, new_car_number = DrawChinese(result_image, plate_name, (x11, y22), 30)

        car_numbers.append(new_car_number)
        result_str += f"车辆{index}--> 车型：{class_name}  车牌号 : {new_car_number}\n"
        index += 1

    gr.Info("Success! 推理完成……")
    result_image = cv2.cvtColor(result_image, cv2.COLOR_BGR2RGB)
    # 返回检测到的车牌号列表
    return result_image, result_str.rstrip("\n"), gr.Dropdown(choices=car_numbers)


def add_owner_name(plate_number, owner_name, owner_phone):
    # 这里没有再加 ensure_login，因为整个界面本身已经被登录页面包着
    if plate_number and owner_name:
        insert_plate(plate_number, owner_name, owner_phone)  # UPSERT：有则更新，无则创建
    rows = get_all_plates()
    # 返回给 Gradio 的表格需要三列：车牌号、车主姓名、电话
    return [[r[0], r[1], r[2]] for r in rows]



def remove_owner_record(plate_number):
    if plate_number:
        delete_plate(plate_number.strip())
    rows = get_all_plates()
    return [[r[0], r[1], r[2]] for r in rows]


def clear_inputs():
    return None, None, "", None, None


def clear_images_in_directory(directory):  # 清空指定目录下的所有图片文件。
    os.makedirs(directory, exist_ok=True)
    for root, dirs, files in os.walk(directory):
        for file in files:
            file_extension = os.path.splitext(file)[1].lower()
            if file_extension in ['.jpg', '.jpeg', '.png', '.bmp', '.gif']:
                file_path = os.path.join(root, file)
                os.remove(file_path)


def _update_progress(progress, value, desc=None):
    if not progress:
        return
    try:
        if desc:
            progress(value, desc=desc)
        else:
            progress(value)
    except Exception:
        try:
            progress(value)
        except Exception:
            pass


# 图片合成为视频
def create_video(input_path, output_video_path, fps, progress=None):
    frame_paths = sorted(
        [os.path.join(input_path, f) for f in os.listdir(input_path) if f.endswith('.jpg')],
        key=lambda p: _frame_sort_key(os.path.basename(p))
    )
    if not frame_paths:
        raise ValueError("未找到可用于合成的视频帧")

    img = cv2.imread(frame_paths[0])
    height, width, _ = img.shape

    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_video_path, fourcc, fps, (width, height))

    cnt = 0
    with tqdm(total=len(frame_paths)) as pbar:
        for frame_path in frame_paths:
            img = cv2.imread(frame_path)
            out.write(img)
            _update_progress(progress, cnt / len(frame_paths), desc="step3:视频合成ing……")
            pbar.update(1)
            cnt = cnt + 1

    out.release()


# 视频拆分为图片
def extract_frames(video_path, output_dir, desired_fps, progress=None):
    os.makedirs(output_dir, exist_ok=True)

    vidcap = cv2.VideoCapture(video_path)
    if not vidcap.isOpened():
        raise ValueError("无法打开视频文件")

    success, image = vidcap.read()
    count = 0
    fps = vidcap.get(cv2.CAP_PROP_FPS)  # 获取视频的原始帧率
    interval = int(round(fps / desired_fps))  # 计算每隔多少帧提取一次
    if interval < 1:
        interval = 1

    total_frames = int(vidcap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total_frames <= 0:
        total_frames = 1

    cnt = 0
    progress_bar = tqdm(total=total_frames, desc='拆分视频帧', unit='frames')

    while success:
        if count % interval == 0:
            frame_path = os.path.join(output_dir, f"frame{count}.jpg")
            cv2.imwrite(frame_path, image)  # 保存帧为图片

            _update_progress(progress, cnt / total_frames, desc="step1:预处理视频帧ing……")
            progress_bar.update(1)
            cnt = cnt + 1

        success, image = vidcap.read()
        count += 1

    vidcap.release()
    progress_bar.close()


def _frame_sort_key(name: str):
    m = re.search(r"(\d+)", name)
    return int(m.group(1)) if m else 0


def run_video_inference(video_path, time_str, desired_fps=60, progress=None, use_cuda=True):
    clear_images_in_directory(VIDEO_FRAME_DIR)
    clear_images_in_directory(VIDEO_OUTPUT_FRAME_DIR)

    _update_progress(progress, 0.0, desc="step0:准备视频处理…")
    extract_frames(video_path, VIDEO_FRAME_DIR, desired_fps, progress=progress)
    frame_files = sorted(
        [f for f in os.listdir(VIDEO_FRAME_DIR) if f.lower().endswith(('.jpg', '.jpeg', '.png'))],
        key=_frame_sort_key
    )
    if not frame_files:
        raise ValueError("视频未能拆分出有效帧")

    try:
        detecter = Kenshutsu(is_cuda=use_cuda)
    except Exception:
        detecter = Kenshutsu(is_cuda=False)
    read_plate = ReadPlate()

    plates_seen = []
    total = len(frame_files)

    def _valid_nums(*vals):
        try:
            return all(np.isfinite(float(v)) for v in vals)
        except Exception:
            return False

    for idx, image_name in enumerate(frame_files):
        image_path = os.path.join(VIDEO_FRAME_DIR, image_name)
        image = cv2.imread(image_path)
        if image is None:
            continue

        try:
            boxes = detecter(image)
        except Exception:
            boxes = []
        plates = []
        for box in boxes:
            if len(box) < 6:
                continue
            x1, y1, x2, y2, the, c = box
            if not _valid_nums(x1, y1, x2, y2, c):
                continue
            x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)
            if int(c) in (2, 5):
                image_ = image[y1:y2, x1:x2]
                result = read_plate(image_)
                if result:
                    plate_name, (x11, y11, x22, y22) = result[0]
                    if not _valid_nums(x11, y11, x22, y22):
                        continue
                    plates.append((x1, y1, x2, y2, plate_name, x11 + x1, y11 + y1, x22 + x1, y22 + y1))
                    plates_seen.append(plate_name)

        for plate in plates:
            x1, y1, x2, y2, plate_name, x11, y11, x22, y22 = plate
            if not _valid_nums(x1, y1, x2, y2, x11, y11, x22, y22):
                continue
            x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)
            x11, y11, x22, y22 = int(x11), int(y11), int(x22), int(y22)
            image = cv2.rectangle(image, (x1, y1), (x2, y2), (0, 255, 0), 2)
            image = cv2.rectangle(image, (x11 - 5, y11 - 5), (x22 + 5, y22 + 5), (0, 0, 255), 2)
            image, _ = DrawChinese(image, plate_name, (x11, y22), 30)

        output_path = os.path.join(VIDEO_OUTPUT_FRAME_DIR, image_name)
        cv2.imwrite(output_path, image)
        _update_progress(progress, 0.2 + 0.6 * (idx + 1) / total, desc="step2:模型推理阶段ing……")

    output_filename = f"{time_str}.mp4"
    output_file_path = os.path.join(RESULT_VIDEO_DIR, output_filename)
    create_video(VIDEO_OUTPUT_FRAME_DIR, output_file_path, desired_fps, progress=progress)
    public_url = f"/result_videos/{output_filename}"
    unique_plates = list(dict.fromkeys(plates_seen))
    return {
        "output_path": output_file_path,
        "public_url": public_url,
        "plates": unique_plates,
        "frame_count": total,
    }


def clear_cache_dirs():
    """
    清理视频处理相关缓存目录
    """
    stats = []
    for d in (VIDEO_FRAME_DIR, VIDEO_OUTPUT_FRAME_DIR, RESULT_VIDEO_DIR, VIDEO_UPLOAD_DIR):
        os.makedirs(d, exist_ok=True)
        removed = 0
        for name in os.listdir(d):
            path = os.path.join(d, name)
            try:
                if os.path.isfile(path):
                    os.remove(path)
                    removed += 1
                elif os.path.isdir(path):
                    # 递归删除目录
                    import shutil
                    shutil.rmtree(path)
                    removed += 1
            except Exception as e:
                print(f"[clear_cache_dirs] 删除失败: {path}", e)
        stats.append({"dir": d, "removed": removed})
    return stats


def handle_login(username, password):
    """
    登录按钮回调：
    成功：返回 token、用户名、隐藏登录界面、显示主界面、清空提示、更新“已登录：xxx”
    失败：清空 token、用户名不变、显示错误提示
    """
    u = (username or "").strip()
    p = (password or "").strip()

    if authenticate(u, p):
        token = create_token(u)
        return (
            token,            # session_token
            u,                # session_username
            gr.update(visible=False),  # login_group
            gr.update(visible=True),   # app_group
            "",               # login_message
            f"已登录：{u}",    # current_user
        )

    return (
        "",                 # session_token
        "",                 # session_username
        gr.update(),        # login_group 不变
        gr.update(),        # app_group 不变
        "账号或密码错误",    # login_message
        "已登录：--",        # current_user
    )


def handle_logout(token, username):
    """
    注销按钮回调：清除 token，恢复到登录界面
    """
    logout_token(token)
    return (
        "",                 # 清空 session_token
        "",                 # 清空 session_username
        gr.update(visible=True),   # 显示登录界面
        gr.update(visible=False),  # 隐藏主界面
        "已登录：--",        # 顶部显示恢复
    )


def process_video(token, input_video, progress=gr.Progress()):
    """
    视频检测函数：第一个参数是 token，并在内部校验登录
    """
    try:
        ensure_login(token)
    except PermissionError as e:
        # 未登录时直接弹出警告
        raise gr.Warning(str(e))

    if input_video is None:
        raise gr.Warning("请先上传视频文件")

    gr.Info("视频模型推理开始……")
    time_str = datetime.now().strftime("%Y-%m-%d-%H-%M-%S")
    video_path = os.path.join(VIDEO_UPLOAD_DIR, f'{time_str}.mp4')

    try:
        with open(input_video, "rb") as video_file:
            video_content = video_file.read()
        with open(video_path, "wb") as output_file:
            output_file.write(video_content)
    except Exception as e:
        raise gr.Warning(f"保存视频文件时出错: {str(e)}")

    gr.Info("视频预处理……")
    try:
        result = run_video_inference(video_path, time_str, desired_fps=60, progress=progress, use_cuda=True)
    except Exception as e:
        raise gr.Warning(str(e))

    gr.Info("Success! 合成完毕……")
    output_video = gr.Video(value=result["output_path"])
    return output_video


def clear_video_inputs():
    return None, None


# 自定义CSS样式
# custom_css = """
# .start-button {
#     color: blue;
#     margin: 4px 2px;
# }

# .clear-button {
#     color: red;
#     margin: 4px 2px;
# }
# """
# 自定义CSS样式
custom_css = """
/* 整个 Gradio 应用的背景图 */
/* 整个 Gradio 应用的背景图 */
.gradio-container {
    background-color: #f3f5f9;
    background-image: url('/static/login_bg.png');
    background-repeat: no-repeat;

    /* 背景图缩小一点，完整显示 */
    background-size: 80%;          /* 可以改 60/80 等自己调 */
    background-position: center 40px;

    min-height: 100vh;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    box-sizing: border-box;
}


/* 登录卡片整体居中 */
.login-container {
    max-width: 420px;
    margin: 350px auto 40px auto;   /* 原来是 80，这里往下挪一点 */
    padding: 28px 30px 32px 30px;
    background: rgba(255, 255, 255, 0.92);
    border-radius: 18px;
    box-shadow: 0 18px 45px rgba(15, 23, 42, 0.08);
    border: 1px solid #e5e7eb;
}


/* 登录标题 */
.login-title h3 {
    margin: 0;
    text-align: center;
    font-size: 22px;
    font-weight: 700;
    color: #111827;
}

/* 副标题 */
.login-subtitle {
    margin-top: 4px;
    margin-bottom: 16px;
    text-align: center;
    font-size: 13px;
    color: #6b7280;
}

/* 输入框样式 */
.login-input textarea,
.login-input input {
    border-radius: 10px !important;
    border: 1px solid #d1d5db !important;
    box-shadow: none !important;
    font-size: 14px;
}

/* 输入框获得焦点 */
.login-input textarea:focus,
.login-input input:focus {
    outline: none !important;
    border-color: #3b82f6 !important;
    box-shadow: 0 0 0 1px #3b82f6 !important;
}

/* 登录按钮 */
.login-button button {
    width: 100%;
    border-radius: 999px;
    border: none;
    padding: 10px 0;
    font-weight: 600;
    letter-spacing: 2px;
    font-size: 14px;
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    color: #ffffff;
    box-shadow: 0 12px 25px rgba(37, 99, 235, 0.35);
    transition: transform 0.08s ease-out, box-shadow 0.08s ease-out,
                background 0.1s ease-out;
}

.login-button button:hover {
    transform: translateY(-1px);
    box-shadow: 0 16px 30px rgba(37, 99, 235, 0.45);
    background: linear-gradient(135deg, #1d4ed8, #1e40af);
}

/* 错误提示 */
.login-message {
    min-height: 18px;
    font-size: 12px;
    color: #dc2626;
    text-align: center;
}

/* 顶部已登录信息 */
.logged-user {
    font-size: 13px;
    color: #6b7280;
}

/* 原有按钮样式保留 */
.start-button {
    color: blue;
    margin: 4px 2px;
}

.clear-button {
    color: red;
    margin: 4px 2px;
}
"""

# 这三个变量一定要放在 Blocks 之前
title_text = """
<center><h1>高效车型车牌检测与识别算法</h1></center>
<center><h5>PS: 页面分类两个模块，分别用来检测图片和视频，请根据需要点击下方导航栏选择</h5></center>
"""

image_tips = """
<p><b>PS: 下方Examples中提供了若干可供测试的图片，点击具体图片即可直接导入上方图片输入框</b></p>
<p><b>PS: 检测结束后右侧下方会显示检测车牌号的结果</b></p>
"""

video_tips = """
<p><b>PS2: 点击下方"开始检测"按钮后右侧视频返回框会有进度条显示当前进度，进度条共有三个阶段，请耐心等待</b></p>
"""

with gr.Blocks(css=custom_css, title='车牌检测页面') as demo:

    # 会话状态：token + 当前用户名
    session_token = gr.State("")
    session_username = gr.State("")

    # ===== 登录区域 =====
    with gr.Group(visible=True, elem_classes="login-container") as login_group:
        gr.Markdown("### 登录系统", elem_classes="login-title")
        gr.Markdown("请输入账号和密码以进入车牌检测系统", elem_classes="login-subtitle")

        username = gr.Textbox(
            label="账号",
            placeholder="例如：admin 或 guest",
            elem_classes="login-input",
        )
        password = gr.Textbox(
            label="密码",
            type="password",
            placeholder="请输入登录密码",
            elem_classes="login-input",
        )

        login_message = gr.Markdown("", elem_classes="login-message")
        login_button = gr.Button("登 录", elem_classes="login-button")

    # ===== 主应用区域 =====
    with gr.Group(visible=False) as app_group:
        # 顶部显示当前用户 + 注销按钮
        with gr.Row():
            current_user = gr.Markdown("已登录：--", elem_classes="logged-user")
            logout_button = gr.Button("注销", elem_classes="clear-button")

        gr.Markdown(title_text)
        with gr.Tabs():
            with gr.TabItem("图像中检测车型及车牌"):
                gr.Markdown(image_tips)
                with gr.Row():
                    with gr.Column():
                        input_image = gr.Image(label="待检测图像")
                        with gr.Row():
                            clear_button = gr.Button("清空图片输入", elem_classes="clear-button")
                            submit_button = gr.Button("开始检测", elem_classes="start-button")
                    with gr.Column():
                        result = gr.Image(label="检测结果")
                        output_logs = gr.Textbox(label="车型及车牌号", lines=3)

                examples = [
                    ["./test_image/1.jpg"],
                    ["./test_image/2.jpg"],
                    ["./test_image/3.jpg"],
                    ["./test_image/4.png"],
                    ["./test_image/5.jpg"],
                    ["./test_image/6.jpg"],
                    ["./test_image/7.png"],
                    ["./test_image/8.jpg"],
                    ["./test_image/9.jpg"],
                    ["./test_image/10.jpg"],
                    ["./test_image/11.jpg"],
                    ["./test_image/12.png"],
                    ["./test_image/13.jpeg"],
                    ["./test_image/14.jpg"],
                ]

                gr.Examples(
                    examples=examples,
                    inputs=[input_image],
                )

                # 添加车主信息
                with gr.Row():
                    with gr.Column():
                        gr.Markdown("### 添加车主信息")
                        plate_dropdown = gr.Dropdown(label="选择车牌号", choices=[], interactive=True)
                        owner_name = gr.Textbox(label="车主姓名", placeholder="请输入车主姓名")
                        owner_phone = gr.Textbox(label="电话", placeholder="可选，支持数字和+号")
                        add_name_button = gr.Button("添加车主信息", elem_classes="start-button")

                # 数据库记录展示
                with gr.Row():
                    with gr.Column():
                        gr.Markdown("### 已记录的车牌信息")
                        db_records = gr.Dataframe(
                            headers=["车牌号", "车主姓名","电话"],
                            datatype=["str", "str", "str"],
                            col_count=(3, "fixed"),
                            row_count=(10, "dynamic"),
                            value=[],
                        )

                with gr.Row():
                    delete_plate_number = gr.Textbox(label="需要删除的车牌号")
                    delete_button = gr.Button("删除记录", elem_classes="clear-button")

                delete_button.click(
                    remove_owner_record,
                    inputs=[delete_plate_number],
                    outputs=[db_records],
                )

                refresh_button = gr.Button("刷新数据库记录")
                refresh_button.click(
                    fn=lambda: [[r[0], r[1], r[2]] for r in get_all_plates()],
                    inputs=[],
                    outputs=[db_records],
                )

                submit_button.click(
                    process_image,
                    inputs=[session_token, input_image],
                    outputs=[result, output_logs, plate_dropdown],
                )

                add_name_button.click(
                    add_owner_name,
                    inputs=[plate_dropdown, owner_name, owner_phone],
                    outputs=[db_records],
                )

                clear_button.click(
                    clear_inputs,
                    inputs=[],
                    outputs=[input_image, result, output_logs, plate_dropdown, owner_name],
                )

            with gr.TabItem("视频中检测车牌"):
                gr.Markdown(video_tips)
                with gr.Row():
                    with gr.Column():
                        input_video = gr.Video(label="输入视频")
                        with gr.Row():
                            clear_video_button = gr.Button("清空视频输入", elem_classes="clear-button")
                            submit_video_button = gr.Button("开始检测", elem_classes="start-button")

                    with gr.Column():
                        output_video = gr.Video(label="输出视频")

                submit_video_button.click(
                    process_video,
                    inputs=[session_token, input_video],
                    outputs=[output_video],
                )
                clear_video_button.click(
                    clear_video_inputs,
                    inputs=[],
                    outputs=[input_video, output_video],
                )

    # ===== 绑定登录/注销回调 =====
    login_button.click(
        handle_login,
        inputs=[username, password],
        outputs=[session_token, session_username, login_group, app_group, login_message, current_user],
    )

    logout_button.click(
        handle_logout,
        inputs=[session_token, session_username],
        outputs=[session_token, session_username, login_group, app_group, current_user],
    )
@asynccontextmanager
async def lifespan(app: FastAPI):
    # === 应用启动阶段 ===
    try:
        ensure_schema()
        print("[lifespan] DB schema ready.")
    except Exception as e:
        print("[lifespan] ensure_schema failed:", e)
    yield
    # === 应用关闭阶段（可选清理资源）===
    # 目前无清理逻辑可留空

# FastAPI 部分与 REST API、前端挂载
app = FastAPI(lifespan=lifespan)

# 允许简单的跨域（方便你以后把前后端分开部署），当前端跟后端同域时也没问题
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 如需更严格控制，可以改成具体域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
TEST_IMAGE_DIR = os.path.join(BASE_DIR, "test_image")
RESULT_VIDEO_DIR = os.path.join(BASE_DIR, "result_videos")
VIDEO_UPLOAD_DIR = os.path.join(BASE_DIR, "user_upload_videos")
VIDEO_FRAME_DIR = os.path.join(BASE_DIR, "videoToImg")
VIDEO_OUTPUT_FRAME_DIR = os.path.join(BASE_DIR, "imgToVideo")

for _dir in (RESULT_VIDEO_DIR, VIDEO_UPLOAD_DIR, VIDEO_FRAME_DIR, VIDEO_OUTPUT_FRAME_DIR):
    os.makedirs(_dir, exist_ok=True)


# ========== API 路由 ==========
api_router = APIRouter(prefix="/api", tags=["plate-recognition"])


@api_router.post("/recognize")
async def api_recognize(image: UploadFile = File(...)):
    """
    单张图片识别接口：
    - 入参：multipart/form-data 中的 image 文件
    - 返回：车牌号、置信度、识别时间、车型、是否在数据库中、车主姓名、相对坐标 bbox 等
    """
    if image.content_type is None or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="仅支持图片类型文件")

    try:
        contents = await image.read()
        nparr = np.frombuffer(contents, np.uint8)
        img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img_bgr is None:
            raise HTTPException(status_code=400, detail="无法解析图片")
    except Exception as e:
        print("读取上传图片失败：", e)
        raise HTTPException(status_code=400, detail="读取图片失败")

    h, w = img_bgr.shape[:2]

    # 直接复用原来的检测 + 识别逻辑
    detecter = Kenshutsu(False)
    read_plate = ReadPlate()
    boxes = detecter(img_bgr)
    plates = []

    # 参考原来的 if 条件，这里认为类别 2 / 5 属于车辆
    for box in boxes:
        x1, y1, x2, y2, the, c = box
        x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)
        if int(c) in (2, 5):
            crop = img_bgr[y1:y2, x1:x2]
            result = read_plate(crop)
            class_name = detecter.names[int(c)] if int(c) < len(detecter.names) else "未知车型"
            if result:
                plate, (x11, y11, x22, y22) = result[0]
                plates.append(
                    (x1, y1, x2, y2, plate,
                     x11 + x1, y11 + y1, x22 + x1, y22 + y1,
                     class_name)
                )

    # 如果没有通过车辆框出车牌，则直接在整张图上尝试识别一次
    if not plates:
        for plate, (x11, y11, x22, y22) in read_plate(img_bgr):
            plates.append(
                (None, None, None, None, plate,
                 int(x11), int(y11), int(x22), int(y22),
                 "未知车型")
            )

    if not plates:
        # 为了前端好处理，这里仍然返回 200 状态码，但 success = False
        return JSONResponse(
            {"success": False, "detail": "未检测到车牌"},
            status_code=200
        )

    # 只取第一块结果
    x1, y1, x2, y2, plate_name, px1, py1, px2, py2, class_name = plates[0]

    # plate bbox 按相对坐标返回（x, y, w, h）
    bw = px2 - px1
    bh = py2 - py1
    rel_bbox = [
        float(px1) / float(w),
        float(py1) / float(h),
        float(bw) / float(w),
        float(bh) / float(h),
    ]

    # 查询数据库中是否已存在该车牌
    # 查询数据库中是否已存在该车牌
    owner_name = None
    owner_phone = None
    in_db = False
    try:
        row = get_owner_by_plate(plate_name)
        if row:
            owner_name, owner_phone = row[0], row[1]
            in_db = True
    except Exception as e:
        print("查询车牌库失败：", e)


    # 目前没有直接从检测器拿到置信度，这里先用一个固定值占位
    conf = 0.99

    return JSONResponse(
        {
            "success": True,
            "message": "识别成功",
            "plateNumber": plate_name,
            "confidence": float(conf),
            "time": datetime.utcnow().isoformat(),
            "vehicleType": class_name,
            "color": "",
            "inDatabase": in_db,
            "ownerName": owner_name,
            "ownerPhone": owner_phone,
            "bbox": rel_bbox,
        }
    )


@api_router.post("/video-recognize")
async def api_video_recognize(video: UploadFile = File(...), fps: int = Form(60)):
    """
    视频识别接口：上传视频，逐帧识别车牌并返回带标注的视频地址与车牌列表
    """
    if video.content_type and not video.content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="仅支持视频文件")

    try:
        fps_value = int(fps)
    except (TypeError, ValueError):
        fps_value = 60
    if fps_value <= 0:
        fps_value = 60

    time_str = datetime.now().strftime("%Y-%m-%d-%H-%M-%S")
    filename = os.path.basename(video.filename or "upload.mp4")
    save_path = os.path.join(VIDEO_UPLOAD_DIR, f"{time_str}_{filename}")

    try:
        contents = await video.read()
        with open(save_path, "wb") as f:
            f.write(contents)
    except Exception as e:
        print("保存上传视频失败:", e)
        raise HTTPException(status_code=500, detail="保存视频失败")

    try:
        result = run_video_inference(save_path, time_str, desired_fps=fps_value, progress=None, use_cuda=True)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print("处理视频失败:", e)
        raise HTTPException(status_code=500, detail="处理视频失败")

    duration_sec = round(result["frame_count"] / max(fps_value, 1), 2)
    return {
        "success": True,
        "videoUrl": result["public_url"],
        "plates": result["plates"],
        "frameCount": result["frame_count"],
        "durationSec": duration_sec,
    }


@api_router.get("/plates")
async def api_get_plates():
    """
    获取数据库中所有车牌 + 车主姓名
    """
    try:
        records = get_all_plates()  # 预期返回 [(plate_number, owner_name, owner_phone, created_at, updated_at), ...]
        items = []
        for plate_number, owner_name, owner_phone, created_at, updated_at in records:
            items.append(
                {
                    "plateNumber": plate_number,
                    "ownerName": owner_name,
                    "ownerPhone": owner_phone,
                    "createdAt": created_at.isoformat() if created_at is not None else None,
                    "updatedAt": updated_at.isoformat() if updated_at is not None else None,
                }
            )
        return {"success": True, "items": items}
    except Exception as e:
        print("获取车主列表失败：", e)
        raise HTTPException(status_code=500, detail="获取车主列表失败")

@api_router.get("/test-images")
async def api_test_images():
    """
    返回 test_image 目录下的测试图片列表
    """
    try:
        if not os.path.isdir(TEST_IMAGE_DIR):
            return {"success": True, "items": []}

        exts = (".jpg", ".jpeg", ".png", ".bmp", ".webp", ".gif")
        files = [
            f for f in os.listdir(TEST_IMAGE_DIR)
            if f.lower().endswith(exts)
        ]
        items = [
            {
                "name": f,
                "url": f"/test_image/{f}",   # 注意这里的前缀要和下面挂载的路由一致
            }
            for f in sorted(files)
        ]
        return {"success": True, "items": items}
    except Exception as e:
        print("列出测试图片失败:", e)
        raise HTTPException(status_code=500, detail="获取测试图片失败")


@api_router.post("/owners")
async def api_save_owner(payload: dict):
    """
    保存 / 更新车主信息：
    - 当前 MySQL 表只有 plate_number + owner_name
    - phone 先不落库，只是从前端传过来占位
    """
    plate_number = (payload.get("plateNumber") or "").strip()
    owner_name = (payload.get("ownerName") or "").strip()
    owner_phone = (payload.get("ownerPhone") or "").strip()  # 暂不入库

    if not plate_number:
        raise HTTPException(status_code=400, detail="车牌号不能为空")
    if not owner_name:
        raise HTTPException(status_code=400, detail="车主姓名不能为空")

    try:
        # 简单处理：先删再插，保证幂等
        # UPSERT：有则更新，无则创建
        insert_plate(plate_number, owner_name, owner_phone)
        return {"success": True}

    except Exception as e:
        print("保存车主信息失败：", e)
        raise HTTPException(status_code=500, detail="保存车主信息失败")

# 修改：PUT /owners/{plate_number}
@api_router.put("/owners/{plate_number}")
async def api_update_owner(plate_number: str, payload: dict):
    """
    修改车牌/车主信息
    - plate_number: 原车牌号（路径参数）
    - body: { newPlateNumber, ownerName, ownerPhone }
    """
    old_plate = (plate_number or "").strip()
    new_plate = (payload.get("newPlateNumber") or "").strip()
    owner_name = (payload.get("ownerName") or "").strip()
    owner_phone = (payload.get("ownerPhone") or "").strip()

    if not old_plate:
        raise HTTPException(status_code=400, detail="原车牌号不能为空")
    if not new_plate:
        raise HTTPException(status_code=400, detail="新车牌号不能为空")
    if not owner_name:
        raise HTTPException(status_code=400, detail="车主姓名不能为空")

    try:
        update_plate(old_plate, new_plate, owner_name, owner_phone)
        return {"success": True}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print("更新车主信息失败：", e)
        raise HTTPException(status_code=500, detail="更新车主信息失败")

# ========== 多页面路由（返回具体 HTML） ==========
# 单条删除：DELETE /api/owners/{plate_number}
@api_router.delete("/owners/{plate_number}")
async def api_delete_owner(plate_number: str):
    plate_number = (plate_number or "").strip()
    if not plate_number:
        raise HTTPException(status_code=400, detail="车牌号不能为空")
    try:
        delete_plate(plate_number)
        return {"success": True}
    except Exception as e:
        print("删除车牌失败：", e)
        raise HTTPException(status_code=500, detail="删除车牌失败")

# 批量删除：POST /api/owners/batch_delete  body: {"plateNumbers": ["苏D...","浙A..."]}
@api_router.post("/owners/batch_delete")
async def api_batch_delete(payload: dict):
    plate_numbers = payload.get("plateNumbers") or []
    if not isinstance(plate_numbers, list) or not plate_numbers:
        raise HTTPException(status_code=400, detail="plateNumbers 必须为非空数组")
    deleted = 0
    for pn in set(str(x).strip() for x in plate_numbers if x):
        try:
            delete_plate(pn)
            deleted += 1
        except Exception as e:
            print("批量删除失败项：", pn, e)
    return {"success": True, "deleted": deleted}


@api_router.post("/cleanup-cache")
async def api_cleanup_cache():
    try:
        stats = clear_cache_dirs()
        return {"success": True, "stats": stats}
    except Exception as e:
        print("清理缓存失败：", e)
        raise HTTPException(status_code=500, detail="清理缓存失败")

app.include_router(api_router)


@app.get("/")
def page_root():
    # 访问根路径统一跳到识别页
    return RedirectResponse(url="/recognition")

@app.get("/login")
def page_login():
    return FileResponse(os.path.join(FRONTEND_DIR, "login.html"))

@app.get("/recognition")
def page_recognition():
    return FileResponse(os.path.join(FRONTEND_DIR, "recognition.html"))

@app.get("/video")
def page_video():
    return FileResponse(os.path.join(FRONTEND_DIR, "video.html"))

@app.get("/batch")
def page_batch():
    return FileResponse(os.path.join(FRONTEND_DIR, "batch.html"))

@app.get("/plates")
def page_plates():
    return FileResponse(os.path.join(FRONTEND_DIR, "plates.html"))

@app.get("/history")
def page_history():
    return FileResponse(os.path.join(FRONTEND_DIR, "history.html"))

@app.get("/settings")
def page_settings():
    return FileResponse(os.path.join(FRONTEND_DIR, "settings.html"))


# 挂载原有 static 目录（如有需要）
if os.path.isdir(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# 挂载测试图片目录：/test_image/xxx.jpg
if os.path.isdir(TEST_IMAGE_DIR):
    app.mount("/test_image", StaticFiles(directory=TEST_IMAGE_DIR), name="test_image")

# 挂载视频输出目录，便于前端直接访问识别后的视频
if os.path.isdir(RESULT_VIDEO_DIR):
    app.mount("/result_videos", StaticFiles(directory=RESULT_VIDEO_DIR), name="result_videos")

# 挂载新的前端页面（纯静态文件）：
# 目录结构：
#   frontend/
#     index.html
#     style.css
#     app.js
if os.path.isdir(FRONTEND_DIR):
    # 使用 StaticFiles(html=True) 可以让 / 自动返回 index.html
    app.mount("/frontend", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

# ========== 保留原来的 Gradio 页面，挂在 /gradio（备用） ==========
try:
    app = gr.mount_gradio_app(app, demo, path="/gradio")
except Exception as e:
    print("挂载 Gradio 页面失败：", e)

if __name__ == '__main__':
    uvicorn.run(app='main:app', host='127.0.0.1', port=9096, reload=False)
