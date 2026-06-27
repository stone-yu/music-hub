FROM python:3.11-slim

WORKDIR /app

# 安装依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple/

# 复制代码
COPY . .

# 暴露端口
EXPOSE 8899

# 启动
CMD ["python", "app.py"]
