# db_operations.py
import os
import mysql.connector
from mysql.connector import Error

# ---- 数据库配置（可用环境变量覆盖）----
DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = int(os.getenv("DB_PORT", "3306"))
DB_USER = os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("DB_PASSWORD", "123456")   # 按你本机改
DB_NAME = os.getenv("DB_NAME", "license_plate_db")
TABLE_NAME = "license_plates"

def create_server_connection():
    """不带 database 的连接（用于创建数据库）"""
    return mysql.connector.connect(
        host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASSWORD
    )

def create_connection():
    """带 database 的连接"""
    return mysql.connector.connect(
        host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASSWORD,
        database=DB_NAME, autocommit=True
    )

# ---------- 自检 / 自愈 ----------
def ensure_database():
    """没有库就创建库（需要有 CREATE DATABASE 权限）"""
    conn = create_server_connection()
    cur = conn.cursor()
    cur.execute(f"CREATE DATABASE IF NOT EXISTS `{DB_NAME}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;")
    conn.close()

def ensure_table():
    """没有表就创建表；缺列/缺索引就补齐"""
    conn = create_connection()
    cur = conn.cursor()
    # 1) 先创建表（如果不存在）
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS `{TABLE_NAME}` (
          `id` INT NOT NULL AUTO_INCREMENT,
          `plate_number` VARCHAR(20) NOT NULL,
          `owner_name` VARCHAR(100) NULL,
          `owner_phone` VARCHAR(20) NULL,
          `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (`id`),
          UNIQUE KEY `uniq_plate_number` (`plate_number`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # 2) 补缺列
    cur.execute("""
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s
    """, (DB_NAME, TABLE_NAME))
    cols = {r[0] for r in cur.fetchall()}
    alters = []
    if "owner_phone" not in cols:
        alters.append("ADD COLUMN `owner_phone` VARCHAR(20) NULL AFTER `owner_name`")
    if "created_at" not in cols:
        alters.append("ADD COLUMN `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP")
    if "updated_at" not in cols:
        alters.append("ADD COLUMN `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")
    if alters:
        cur.execute(f"ALTER TABLE `{TABLE_NAME}` " + ", ".join(alters) + ";")

    # 3) 补唯一索引
    cur.execute("""
        SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s AND INDEX_NAME='uniq_plate_number'
    """, (DB_NAME, TABLE_NAME))
    if cur.fetchone() is None:
        cur.execute(f"CREATE UNIQUE INDEX `uniq_plate_number` ON `{TABLE_NAME}` (`plate_number`);")

    conn.commit()
    conn.close()

def ensure_schema():
    """对外只调这个：先确保库，再确保表"""
    try:
        ensure_database()
    except Error:
        # 没有 CREATE DATABASE 权限时，跳过建库；要求库已存在
        pass
    ensure_table()

# ---------- 业务函数 ----------
def insert_plate(plate_number, owner_name=None, owner_phone=None):
    """
    UPSERT：主键冲突（唯一索引）则更新姓名/电话
    """
    conn = create_connection()
    cur = conn.cursor()
    sql = f"""
        INSERT INTO `{TABLE_NAME}` (plate_number, owner_name, owner_phone)
        VALUES (%s, %s, %s)
        ON DUPLICATE KEY UPDATE
          owner_name=VALUES(owner_name),
          owner_phone=VALUES(owner_phone),
          updated_at=CURRENT_TIMESTAMP
    """
    cur.execute(sql, (plate_number, owner_name, owner_phone))
    conn.commit()
    conn.close()
    return True

def update_plate(old_plate_number, new_plate_number, owner_name=None, owner_phone=None):
    """
    更新车牌信息；允许修改车牌号/姓名/电话
    - 若新车牌号与旧车牌号不同且已存在冲突，则抛出异常
    """
    conn = create_connection()
    cur = conn.cursor()
    try:
        cur.execute(f"SELECT id FROM `{TABLE_NAME}` WHERE plate_number=%s", (old_plate_number,))
        row = cur.fetchone()
        if row is None:
            raise ValueError("待修改的车牌不存在")

        if new_plate_number != old_plate_number:
            cur.execute(f"SELECT id FROM `{TABLE_NAME}` WHERE plate_number=%s", (new_plate_number,))
            if cur.fetchone():
                raise ValueError("新的车牌号已存在，不能重复")

        cur.execute(
            f"""
            UPDATE `{TABLE_NAME}`
            SET plate_number=%s, owner_name=%s, owner_phone=%s, updated_at=CURRENT_TIMESTAMP
            WHERE plate_number=%s
            """,
            (new_plate_number, owner_name, owner_phone, old_plate_number),
        )
        conn.commit()
        return True
    finally:
        conn.close()

def delete_plate(plate_number):
    conn = create_connection()
    cur = conn.cursor()
    cur.execute(f"DELETE FROM `{TABLE_NAME}` WHERE plate_number=%s", (plate_number,))
    conn.commit()
    conn.close()
    return True

def get_all_plates():
    """返回 [(plate_number, owner_name, owner_phone, created_at, updated_at), ...]"""
    conn = create_connection()
    cur = conn.cursor()
    cur.execute(f"SELECT plate_number, owner_name, owner_phone, created_at, updated_at FROM `{TABLE_NAME}` ORDER BY updated_at DESC, id DESC")
    rows = cur.fetchall()
    conn.close()
    return rows

def get_owner_by_plate(plate_number):
    """精确查某车牌 -> (owner_name, owner_phone) 或 None"""
    conn = create_connection()
    cur = conn.cursor()
    cur.execute(f"SELECT owner_name, owner_phone FROM `{TABLE_NAME}` WHERE plate_number=%s LIMIT 1", (plate_number,))
    row = cur.fetchone()
    conn.close()
    return row
