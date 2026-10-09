package com.jello.music.ui;

import javafx.scene.image.Image;
import javafx.scene.text.Font;

import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * 资源加载：字体与图标。
 *
 * <p>资源来自原 Vue 版 {@code src/assets/sigma/}，已复制到本工程的
 * {@code src/main/resources/com/jello/music/} 下，保证 1:1 复用同一批美术资源。
 *
 * <p>字体是原版的 helvetica-neue（内部名为 JelloLight / JelloMedium），
 * 加载后所有文字都用它，而不是系统字体——这是"视觉一致"的关键。
 */
public final class Assets {

    private static final Map<String, Image> IMAGES = new HashMap<>();

    public static final Font FONT_LIGHT = loadFont("/com/jello/music/fonts/helvetica-neue-light.ttf");
    public static final Font FONT_MEDIUM = loadFont("/com/jello/music/fonts/helvetica-neue-medium.ttf");

    /**
     * 加载字体。注意 {@code Font.loadFont(InputStream, double)} 没有 familyName 重载，
     * 返回字体的 {@code getFamily()} 就是字体内部的 family 名。
     */
    private static Font loadFont(String resourcePath) {
        try (InputStream in = Assets.class.getResourceAsStream(resourcePath)) {
            if (in == null) {
                throw new IllegalStateException("字体资源缺失: " + resourcePath);
            }
            return Font.loadFont(in, 14);
        } catch (Exception e) {
            throw new IllegalStateException("字体加载失败: " + resourcePath, e);
        }
    }

    /**
     * 按字号取字体。原版各处字号固定，这里统一以 JelloLight 为基准，
     * 需要 medium 时调 {@link #medium}。
     */
    public static Font light(double size) {
        return Font.font(FONT_LIGHT.getFamily(), size);
    }

    public static Font medium(double size) {
        return Font.font(FONT_MEDIUM.getFamily(), size);
    }

    /** 加载并缓存图标。图标尺寸很小，缓存后可反复复用。 */
    public static Image image(String name) {
        return IMAGES.computeIfAbsent(name, n -> {
            String p = "/com/jello/music/icons/" + n;
            try (InputStream in = Assets.class.getResourceAsStream(p)) {
                if (in == null) {
                    throw new IllegalStateException("图标资源缺失: " + p);
                }
                return new Image(in);
            } catch (IllegalStateException e) {
                throw e;
            } catch (Exception e) {
                throw new IllegalStateException("图标加载失败: " + p, e);
            }
        });
    }

    private Assets() {
    }
}